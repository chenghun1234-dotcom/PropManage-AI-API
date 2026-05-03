import { Router } from 'itty-router';

const router = Router();

// Helper to handle CORS
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};


// Error helper
const errorResponse = (message, status = 400) => 
  new Response(JSON.stringify({ error: message }), { 
    status, 
    headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
  });

// Middleware for API Key Auth & Rate Limiting
const authMiddleware = async (request, env) => {
  const apiKey = request.headers.get('X-API-Key');
  if (!apiKey && request.url.includes('/api/v1/')) return;
  
  if (apiKey) {
    const keyData = await env.DB.prepare('SELECT * FROM api_keys WHERE key = ?').bind(apiKey).first();
    if (!keyData) throw new Error('Invalid API Key');
    
    // Simplified Rate Limiting (Using KV or memory would be better, but let's check DB counts for today)
    const usageToday = await env.DB.prepare(
      "SELECT COUNT(*) as count FROM requests_log WHERE created_at > date('now') AND request_payload LIKE ?"
    ).bind(`%${apiKey}%`).first();

    const limits = { 'Basic': 100, 'Pro': 10000, 'Ultra': 50000 };
    if (usageToday.count >= (limits[keyData.tier] || 100)) {
      throw new Error(`Rate limit exceeded for ${keyData.tier} tier`);
    }

    request.client = keyData;
  }
};

// Real-time Notification Helper (WebHook/Email Simulation)
const triggerNotification = async (env, urgency, category, summary) => {
  if (urgency === 'High') {
    console.log(`[ALERT] High Urgency Issue: ${category} - ${summary}`);
    // Here you would call fetch('https://webhook.site/...') or an Email API
  }
};

// DB Logger Helper
const logToDB = async (env, endpoint, requestData, responseData, clientName = 'Guest') => {
  try {
    await env.DB.prepare(
      'INSERT INTO requests_log (endpoint, request_payload, response_payload) VALUES (?, ?, ?)'
    ).bind(endpoint, JSON.stringify(requestData), JSON.stringify(responseData)).run();
    
    // Trigger notification for high urgency maintenance
    if (responseData.urgency === 'High') {
      await triggerNotification(env, 'High', responseData.category, responseData.summary);
    }
  } catch (e) {
    console.error('DB Logging failed:', e);
  }
};

// 1. Upgraded Lead Qualification API
router.post('/api/v1/inquiry/respond', async (request, env) => {
  const { inquiry, property_info, custom_system_prompt } = await request.json();
  
  if (!inquiry) return errorResponse('Missing inquiry text');

  // Ultra Tier Feature: Custom Prompt Tuning
  let systemPrompt = `You are a professional AI Property Manager. Answer based on property info. Evaluate lead 1-10.
  Property Info: ${JSON.stringify(property_info || "General info")}`;
  
  if (request.client?.tier === 'Ultra' && custom_system_prompt) {
    systemPrompt = custom_system_prompt + " | Context: " + systemPrompt;
  }

  try {
    const response = await env.AI.run('@cf/meta/llama-3-8b-instruct', {
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: inquiry }
      ],
      response_format: { type: 'json_object' }
    });

    let result = typeof response.response === 'string' ? JSON.parse(response.response) : response.response;
    
    // DB Logging
    await logToDB(env, '/api/v1/inquiry/respond', { inquiry, property_info, apiKey: request.headers.get('X-API-Key') }, result);

    return new Response(JSON.stringify(result), { 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
    });
  } catch (err) {
    return errorResponse('AI processing failed: ' + err.message, 500);
  }
});

// 2. Upgraded Maintenance Triage API
router.post('/api/v1/maintenance/classify', async (request, env) => {
  const { request_text } = await request.json();
  
  if (!request_text) return errorResponse('Missing request text');

  const systemPrompt = `Analyze the maintenance request. 
  Classify category and urgency. 
  Crucially, provide 2-3 "self_check_steps" for the tenant to try before a technician is dispatched.
  
  Return ONLY a JSON object:
  {
    "category": "Plumbing | Electrical | Appliance | HVAC | Security | Other",
    "urgency": "High | Medium | Low",
    "summary": "one sentence",
    "self_check_steps": ["step 1", "step 2"],
    "technician_required": boolean
  }`;

  try {
    const response = await env.AI.run('@cf/meta/llama-3-8b-instruct', {
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: request_text }
      ],
      response_format: { type: 'json_object' }
    });

    let result = typeof response.response === 'string' ? JSON.parse(response.response) : response.response;

    // DB Logging
    await logToDB(env, '/api/v1/maintenance/classify', { request_text, apiKey: request.headers.get('X-API-Key') }, result);

    return new Response(JSON.stringify(result), { 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
    });
  } catch (err) {
    return errorResponse('AI classification failed: ' + err.message, 500);
  }
});

// 3. Upgraded Lease Parsing API
router.post('/api/v1/document/analyze-lease', async (request, env) => {
  const { lease_text } = await request.json();
  
  if (!lease_text) return errorResponse('Missing lease text');

  const systemPrompt = `Extract structured data and highlight any "atypical_clauses" or risks.
  Return ONLY a JSON object:
  {
    "dates": { "start": "YYYY-MM-DD", "end": "YYYY-MM-DD", "rent_due_day": number },
    "financials": { "rent": number, "deposit": number, "currency": "string" },
    "special_provisions": ["list"],
    "atypical_clauses": ["any unusual terms found"],
    "compliance_check": "brief summary of standard vs custom terms"
  }`;

  try {
    const response = await env.AI.run('@cf/meta/llama-3-8b-instruct', {
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: lease_text }
      ],
      response_format: { type: 'json_object' }
    });

    let result = typeof response.response === 'string' ? JSON.parse(response.response) : response.response;

    // DB Logging
    await logToDB(env, '/api/v1/document/analyze-lease', { lease_text, apiKey: request.headers.get('X-API-Key') }, result);

    return new Response(JSON.stringify(result), { 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
    });
  } catch (err) {
    return errorResponse('AI parsing failed: ' + err.message, 500);
  }
});

// 4. Admin Stats API
router.get('/api/v1/admin/stats', async (request, env) => {
  try {
    const stats = await env.DB.prepare(`
      SELECT 
        endpoint, 
        COUNT(*) as count
      FROM requests_log 
      GROUP BY endpoint
    `).all();

    const maintenanceSummary = await env.DB.prepare(`
      SELECT 
        json_extract(response_payload, '$.category') as category,
        COUNT(*) as count
      FROM requests_log 
      WHERE endpoint LIKE '%maintenance%'
      GROUP BY category
    `).all();

    return new Response(JSON.stringify({ 
      usage: stats.results,
      maintenance_distribution: maintenanceSummary.results
    }), { 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
    });
  } catch (err) {
    return errorResponse('Failed to fetch stats: ' + err.message, 500);
  }
});

// 5. Audio-to-Triage API (STT + Classification)
router.post('/api/v1/maintenance/audio-triage', async (request, env) => {
  const blob = await request.arrayBuffer();
  
  if (!blob || blob.byteLength === 0) return errorResponse('Missing audio data');

  try {
    // 1. STT (Whisper)
    const sttResponse = await env.AI.run('@cf/openai/whisper', {
      audio: [...new Uint8Array(blob)]
    });
    
    const transcription = sttResponse.text;

    // 2. Triage (Llama 3)
    const systemPrompt = `Analyze the maintenance request. Return ONLY JSON: { "category": "...", "urgency": "...", "summary": "...", "self_check_steps": [] }`;
    const triageResponse = await env.AI.run('@cf/meta/llama-3-8b-instruct', {
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: transcription }
      ],
      response_format: { type: 'json_object' }
    });

    let result = typeof triageResponse.response === 'string' ? JSON.parse(triageResponse.response) : triageResponse.response;
    result.transcription = transcription;

    await logToDB(env, '/api/v1/maintenance/audio-triage', { audio_size: blob.byteLength, apiKey: request.headers.get('X-API-Key') }, result);

    return new Response(JSON.stringify(result), { 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
    });
  } catch (err) {
    return errorResponse('Audio processing failed: ' + err.message, 500);
  }
});

// Serve Dashboard
router.get('/', (request) => {
  return new Response(DASHBOARD_HTML, {
    headers: { 'Content-Type': 'text/html' }
  });
});

// Handle OPTIONS (CORS)
router.options('*', () => new Response(null, { headers: corsHeaders }));

// 404 Handler
router.all('*', () => errorResponse('Not Found', 404));

export default {
  fetch: async (request, env) => {
    try {
      await authMiddleware(request, env);
      return await router.handle(request, env);
    } catch (err) {
      return errorResponse(err.message, 401);
    }
  }
};

const DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>PropManage AI | Premium B2B API</title>
    <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;600;700&display=swap" rel="stylesheet">
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
    <style>
        :root { --primary: #6366f1; --primary-glow: rgba(99, 102, 241, 0.5); --bg: #0f172a; --card-bg: rgba(30, 41, 59, 0.7); --text: #f8fafc; --text-dim: #94a3b8; --accent: #10b981; }
        * { margin: 0; padding: 0; box-sizing: border-box; font-family: 'Outfit', sans-serif; }
        body { background: var(--bg); color: var(--text); overflow-x: hidden; background-image: radial-gradient(circle at 20% 20%, rgba(99, 102, 241, 0.15) 0%, transparent 40%), radial-gradient(circle at 80% 80%, rgba(16, 185, 129, 0.1) 0%, transparent 40%); min-height: 100vh; scroll-behavior: smooth; }
        .navbar { display: flex; justify-content: space-between; padding: 2rem 5%; align-items: center; backdrop-filter: blur(10px); position: sticky; top: 0; z-index: 100; }
        .logo { font-size: 1.5rem; font-weight: 700; background: linear-gradient(to right, #818cf8, #34d399); -webkit-background-clip: text; -webkit-text-fill-color: transparent; letter-spacing: -1px; }
        .container { max-width: 1200px; margin: 0 auto; padding: 4rem 5%; }
        .hero { text-align: center; margin-bottom: 6rem; }
        .hero h1 { font-size: 4rem; margin-bottom: 1.5rem; line-height: 1.1; font-weight: 700; }
        .hero p { color: var(--text-dim); font-size: 1.2rem; max-width: 600px; margin: 0 auto 2rem; }
        .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 2rem; }
        .card { background: var(--card-bg); border: 1px solid rgba(255, 255, 255, 0.1); padding: 2.5rem; border-radius: 24px; backdrop-filter: blur(12px); transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1); position: relative; overflow: hidden; }
        .card:hover { transform: translateY(-10px); border-color: var(--primary); box-shadow: 0 20px 40px rgba(0, 0, 0, 0.4); }
        .card i { font-size: 2rem; margin-bottom: 1.5rem; display: block; }
        .card h3 { font-size: 1.5rem; margin-bottom: 1rem; }
        .card p { color: var(--text-dim); line-height: 1.6; }
        .endpoint { font-family: monospace; background: rgba(0,0,0,0.3); padding: 0.5rem; border-radius: 8px; display: inline-block; margin-top: 1.5rem; font-size: 0.8rem; color: var(--primary); }
        .cta-button { background: var(--primary); color: white; padding: 1rem 2rem; border-radius: 12px; text-decoration: none; font-weight: 600; display: inline-block; transition: all 0.3s; box-shadow: 0 4px 15px var(--primary-glow); border: none; cursor: pointer; }
        .cta-button:hover { transform: scale(1.05); box-shadow: 0 8px 25px var(--primary-glow); }
        .section-title { text-align: center; margin-bottom: 4rem; font-size: 2.5rem; }
        #admin-panel, #code-snippets { margin-top: 8rem; background: rgba(15, 23, 42, 0.5); border: 1px solid rgba(255, 255, 255, 0.05); border-radius: 32px; padding: 4rem; }
        .stats-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 4rem; align-items: center; }
        .chart-container { background: rgba(0,0,0,0.2); padding: 2rem; border-radius: 24px; border: 1px solid rgba(255,255,255,0.05); }
        #playground { margin-top: 8rem; padding: 4rem; background: var(--card-bg); border-radius: 32px; }
        .playground-content { display: grid; grid-template-columns: 1fr 1fr; gap: 2rem; }
        textarea, .code-box { width: 100%; height: 350px; background: rgba(0,0,0,0.2); border: 1px solid rgba(255,255,255,0.1); border-radius: 16px; padding: 1.5rem; color: white; font-family: monospace; resize: none; overflow: auto; }
        .result-box { background: #000; border-radius: 16px; padding: 1.5rem; font-family: monospace; color: var(--accent); overflow-y: auto; height: 350px; border: 1px solid var(--primary); }
        .tab-buttons { display: flex; gap: 1rem; margin-bottom: 2rem; justify-content: center; }
        .tab-btn { background: none; border: 1px solid rgba(255, 255, 255, 0.1); color: var(--text-dim); padding: 0.8rem 1.5rem; border-radius: 100px; cursor: pointer; transition: all 0.2s; }
        .tab-btn.active { background: var(--primary); color: white; border-color: var(--primary); }
    </style>
</head>
<body>
    <nav class="navbar">
        <div class="logo">PROPMANAGE AI</div>
        <div style="display: flex; gap: 1.5rem;">
            <a href="#playground" class="tab-btn">Playground</a>
            <a href="#code-snippets" class="tab-btn">Connect SDK</a>
            <a href="#admin-panel" class="cta-button">Admin Portal</a>
        </div>
    </nav>

    <div class="container">
        <header class="hero">
            <h1>Enterprise <span style="color: var(--accent)">Property Intelligence</span></h1>
            <p>The global standard for AI-driven property management. Scale your operations with edge-native speed and LLM-powered accuracy.</p>
        </header>

        <div class="grid">
            <div class="card"><i>🤖</i><h3>Lead Qualification</h3><p>Score leads and automate responses with deep intent analysis and language detection.</p><div class="endpoint">POST /api/v1/inquiry/respond</div></div>
            <div class="card"><i>🛠️</i><h3>Maintenance Triage</h3><p>Classify repairs and provide cost-saving self-check steps instantly via text or voice.</p><div class="endpoint">POST /api/v1/maintenance/classify</div></div>
            <div class="card"><i>📄</i><h3>Lease Analysis</h3><p>Extract data and detect risky clauses or compliance issues in seconds.</p><div class="endpoint">POST /api/v1/document/analyze-lease</div></div>
        </div>

        <section id="playground">
            <h2 class="section-title">API Explorer</h2>
            <div class="tab-buttons">
                <button class="tab-btn active" onclick="switchTab('inquiry')">Lead Response</button>
                <button class="tab-btn" onclick="switchTab('maintenance')">Maintenance</button>
                <button class="tab-btn" onclick="switchTab('lease')">Lease Parser</button>
            </div>
            <div class="playground-content">
                <div>
                    <textarea id="input-payload">{
  "inquiry": "Is the deposit negotiable? I have a small cat.",
  "property_info": { "deposit": "$2000", "pet_policy": "Small pets allowed" }
}</textarea>
                    <button class="cta-button" style="width: 100%; margin-top: 1rem;" onclick="testAPI()">Run Request</button>
                </div>
                <div class="result-box" id="result-display">// Response will appear here...</div>
            </div>
        </section>

        <section id="code-snippets">
            <h2 class="section-title">Connect to Your App</h2>
            <div class="tab-buttons">
                <button class="tab-btn active" onclick="switchCode('javascript')">JavaScript (Fetch)</button>
                <button class="tab-btn" onclick="switchCode('curl')">cURL</button>
                <button class="tab-btn" onclick="switchCode('python')">Python</button>
            </div>
            <div class="code-box" id="code-display"></div>
        </section>

        <section id="admin-panel">
            <h2 class="section-title">Admin Analytics</h2>
            <div class="stats-grid">
                <div class="chart-container"><h4 style="margin-bottom: 1.5rem; text-align: center;">API Usage</h4><canvas id="usageChart"></canvas></div>
                <div class="chart-container"><h4 style="margin-bottom: 1.5rem; text-align: center;">Maintenance Distribution</h4><canvas id="distChart"></canvas></div>
            </div>
            <button class="cta-button" style="display: block; margin: 3rem auto 0;" onclick="refreshStats()">Refresh Insights</button>
        </section>
    </div>

    <script>
        let currentEndpoint = '/api/v1/inquiry/respond';
        let usageChart, distChart;

        const payloads = {
            inquiry: { "inquiry": "Deposit negotiable?", "property_info": { "deposit": "$2000" } },
            maintenance: { "request_text": "Sink leaking" },
            lease: { "lease_text": "Standard Lease Agreement..." }
        };

        const snippets = {
            javascript: \`fetch('https://' + window.location.host + '/api/v1/inquiry/respond', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-API-Key': 'YOUR_API_KEY'
  },
  body: JSON.stringify({
    inquiry: "Is the deposit negotiable?",
    property_info: { deposit: "$2000" }
  })
}).then(res => res.json()).then(console.log);\`,
            curl: \`curl -X POST https://' + window.location.host + '/api/v1/inquiry/respond \\\\
  -H "Content-Type: application/json" \\\\
  -H "X-API-Key: YOUR_API_KEY" \\\\
  -d '{"inquiry": "Is the deposit negotiable?", "property_info": {"deposit": "$2000"}}'\`,
            python: \`import requests
url = "https://" + window.location.host + "/api/v1/inquiry/respond"
headers = {"X-API-Key": "YOUR_API_KEY"}
data = {"inquiry": "Is the deposit negotiable?", "property_info": {"deposit": "$2000"}}
response = requests.post(url, json=data, headers=headers)
print(response.json())\`
        };

        function switchTab(type) {
            document.querySelectorAll('#playground .tab-btn').forEach(b => b.classList.remove('active'));
            event.target.classList.add('active');
            currentEndpoint = '/api/v1/' + (type === 'inquiry' ? 'inquiry/respond' : (type === 'maintenance' ? 'maintenance/classify' : 'document/analyze-lease'));
            document.getElementById('input-payload').value = JSON.stringify(payloads[type], null, 2);
        }

        function switchCode(lang) {
            document.querySelectorAll('#code-snippets .tab-btn').forEach(b => b.classList.remove('active'));
            event.target.classList.add('active');
            document.getElementById('code-display').innerText = snippets[lang];
        }

        async function testAPI() {
            const display = document.getElementById('result-display');
            display.innerText = '// Processing via Edge AI...';
            try {
                const response = await fetch(currentEndpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: document.getElementById('input-payload').value });
                const data = await response.json();
                display.innerText = JSON.stringify(data, null, 2);
                refreshStats();
            } catch (e) { display.innerText = '// Error: ' + e.message; }
        }

        async function refreshStats() {
            try {
                const res = await fetch('/api/v1/admin/stats');
                const data = await res.json();
                updateCharts(data);
            } catch (e) { console.error('Stats failed', e); }
        }

        function updateCharts(data) {
            const usageCtx = document.getElementById('usageChart').getContext('2d');
            const distCtx = document.getElementById('distChart').getContext('2d');
            if (usageChart) usageChart.destroy();
            if (distChart) distChart.destroy();
            usageChart = new Chart(usageCtx, { type: 'bar', data: { labels: data.usage.map(u => u.endpoint.split('/').pop()), datasets: [{ label: 'Calls', data: data.usage.map(u => u.count), backgroundColor: '#6366f1' }] }, options: { plugins: { legend: { display: false } } } });
            distChart = new Chart(distCtx, { type: 'doughnut', data: { labels: data.maintenance_distribution.map(d => d.category || 'Other'), datasets: [{ data: data.maintenance_distribution.map(d => d.count), backgroundColor: ['#10b981', '#f59e0b', '#ef4444', '#6366f1'] }] } });
        }

        window.onload = () => { refreshStats(); switchCode('javascript'); };
    </script>
</body>
</html>`;
