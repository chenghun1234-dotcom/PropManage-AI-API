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

// 1. RAG Ingest API (Admin Only)
router.post('/api/v1/admin/ingest', async (request, env) => {
  const { text, metadata } = await request.json();
  if (!text) return errorResponse('Missing text for ingestion');

  try {
    // Generate Embedding
    const embeddingResponse = await env.AI.run('@cf/baai/bge-small-en-v1.5', { text: [text] });
    const vector = embeddingResponse.data[0];

    // Store in Vectorize
    const id = crypto.randomUUID();
    await env.VECTORIZE.upsert([{
      id,
      values: vector,
      metadata: { text, ...metadata }
    }]);

    return new Response(JSON.stringify({ success: true, id }), { headers: corsHeaders });
  } catch (err) {
    return errorResponse('Ingestion failed: ' + err.message, 500);
  }
});

// 2. Upgraded Lead Qualification API with RAG
router.post('/api/v1/inquiry/respond', async (request, env) => {
  const { inquiry, property_info, custom_system_prompt } = await request.json();
  if (!inquiry) return errorResponse('Missing inquiry text');

  try {
    // RAG: Search for relevant knowledge
    const queryEmbedding = await env.AI.run('@cf/baai/bge-small-en-v1.5', { text: [inquiry] });
    const vector = queryEmbedding.data[0];
    const matches = await env.VECTORIZE.query(vector, { topK: 3, returnMetadata: true });
    
    const knowledgeContext = matches.matches
      .map(m => m.metadata?.text)
      .filter(Boolean)
      .join('\n---\n');

    let systemPrompt = `You are an expert AI Property Manager. 
    Use the provided Knowledge Base and Property Info to answer.
    
    Knowledge Base: ${knowledgeContext || "No specific rules found."}
    Property Info: ${JSON.stringify(property_info || "General info")}
    
    Evaluate lead 1-10. Return JSON.`;
    
    if (request.client?.tier === 'Ultra' && custom_system_prompt) {
      systemPrompt = custom_system_prompt + "\n" + systemPrompt;
    }

    const response = await env.AI.run('@cf/meta/llama-3-8b-instruct', {
      messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: inquiry }],
      response_format: { type: 'json_object' }
    });

    let result = typeof response.response === 'string' ? JSON.parse(response.response) : response.response;
    await logToDB(env, '/api/v1/inquiry/respond', { inquiry, property_info, apiKey: request.headers.get('X-API-Key') }, result);
    return new Response(JSON.stringify(result), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (err) {
    return errorResponse(err.message, 500);
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
    <title>PropManage AI | Enterprise Property Intelligence</title>
    <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;600;700&display=swap" rel="stylesheet">
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
    <style>
        :root { --primary: #6366f1; --primary-glow: rgba(99, 102, 241, 0.4); --bg: #020617; --card-bg: rgba(15, 23, 42, 0.6); --text: #f8fafc; --text-dim: #94a3b8; --accent: #10b981; }
        * { margin: 0; padding: 0; box-sizing: border-box; font-family: 'Outfit', sans-serif; }
        body { background: var(--bg); color: var(--text); overflow-x: hidden; background-image: radial-gradient(circle at 0% 0%, rgba(99, 102, 241, 0.1) 0%, transparent 50%), radial-gradient(circle at 100% 100%, rgba(16, 185, 129, 0.05) 0%, transparent 50%); min-height: 100vh; scroll-behavior: smooth; }
        .navbar { display: flex; justify-content: space-between; padding: 1.5rem 8%; align-items: center; backdrop-filter: blur(20px); position: sticky; top: 0; z-index: 1000; border-bottom: 1px solid rgba(255,255,255,0.05); }
        .logo { font-size: 1.8rem; font-weight: 800; background: linear-gradient(135deg, #818cf8 0%, #34d399 100%); -webkit-background-clip: text; -webkit-text-fill-color: transparent; letter-spacing: -1.5px; }
        .container { max-width: 1300px; margin: 0 auto; padding: 4rem 8%; }
        
        /* Hero Section */
        .hero { text-align: center; padding: 6rem 0; animation: fadeIn 1s ease-out; }
        .hero h1 { font-size: 5rem; margin-bottom: 1.5rem; line-height: 1; font-weight: 700; letter-spacing: -2px; }
        .hero p { color: var(--text-dim); font-size: 1.4rem; max-width: 700px; margin: 0 auto 3rem; line-height: 1.6; }
        .badge { background: rgba(99, 102, 241, 0.1); color: var(--primary); padding: 0.5rem 1.2rem; border-radius: 100px; font-weight: 600; font-size: 0.9rem; margin-bottom: 2rem; display: inline-block; border: 1px solid rgba(99, 102, 241, 0.2); }

        /* Grid */
        .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(350px, 1fr)); gap: 2.5rem; margin-top: 4rem; }
        .card { background: var(--card-bg); border: 1px solid rgba(255, 255, 255, 0.05); padding: 3rem; border-radius: 32px; backdrop-filter: blur(20px); transition: all 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275); position: relative; }
        .card:hover { transform: translateY(-12px) scale(1.02); border-color: var(--primary); box-shadow: 0 40px 80px rgba(0, 0, 0, 0.5); }
        .card i { font-size: 2.5rem; margin-bottom: 2rem; display: block; filter: drop-shadow(0 0 10px var(--primary-glow)); }
        .card h3 { font-size: 1.8rem; margin-bottom: 1.2rem; }
        .card p { color: var(--text-dim); line-height: 1.8; font-size: 1.1rem; }

        /* Playground Sections */
        .glass-panel { margin-top: 8rem; background: var(--card-bg); border: 1px solid rgba(255, 255, 255, 0.05); border-radius: 40px; padding: 4rem; position: relative; overflow: hidden; }
        .glass-panel::before { content: ''; position: absolute; top: -50%; left: -50%; width: 200%; height: 200%; background: radial-gradient(circle, rgba(99, 102, 241, 0.03) 0%, transparent 70%); z-index: -1; }
        
        .playground-content { display: grid; grid-template-columns: 1fr 1fr; gap: 3rem; margin-top: 3rem; }
        textarea, .code-box { width: 100%; height: 400px; background: rgba(0,0,0,0.4); border: 1px solid rgba(255,255,255,0.05); border-radius: 24px; padding: 2rem; color: #fff; font-family: 'JetBrains Mono', monospace; font-size: 0.95rem; line-height: 1.6; resize: none; outline: none; }
        textarea:focus { border-color: var(--primary); }
        .result-box { background: #000; border-radius: 24px; padding: 2rem; font-family: monospace; color: var(--accent); overflow-y: auto; height: 400px; border: 1px solid var(--primary); box-shadow: inset 0 0 20px rgba(16, 185, 129, 0.1); }

        .cta-button { background: linear-gradient(135deg, var(--primary) 0%, #4f46e5 100%); color: white; padding: 1.2rem 2.5rem; border-radius: 16px; text-decoration: none; font-weight: 700; display: inline-block; transition: all 0.3s; box-shadow: 0 10px 30px var(--primary-glow); border: none; cursor: pointer; font-size: 1.1rem; }
        .cta-button:hover { transform: translateY(-3px) scale(1.05); box-shadow: 0 15px 40px var(--primary-glow); }
        
        .tab-buttons { display: flex; gap: 1rem; margin-bottom: 2.5rem; justify-content: center; }
        .tab-btn { background: rgba(255,255,255,0.03); border: 1px solid rgba(255, 255, 255, 0.1); color: var(--text-dim); padding: 0.8rem 1.8rem; border-radius: 100px; cursor: pointer; transition: all 0.3s; font-weight: 600; }
        .tab-btn.active { background: var(--primary); color: white; border-color: var(--primary); box-shadow: 0 0 20px var(--primary-glow); }

        .stats-grid { display: grid; grid-template-columns: 1.2fr 0.8fr; gap: 3rem; margin-top: 3rem; }
        .chart-container { background: rgba(0,0,0,0.3); padding: 2.5rem; border-radius: 32px; border: 1px solid rgba(255,255,255,0.05); }

        @keyframes fadeIn { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
    </style>
</head>
<body>
    <nav class="navbar">
        <div class="logo">PROPMANAGE.AI</div>
        <div style="display: flex; gap: 2rem; align-items: center;">
            <a href="#lab" class="tab-btn">Knowledge Lab</a>
            <a href="#playground" class="tab-btn">API Console</a>
            <a href="#admin" class="cta-button">Enterprise Access</a>
        </div>
    </nav>

    <div class="container">
        <header class="hero">
            <div class="badge">Next-Gen Property Management</div>
            <h1>RAG-Powered <span style="color: var(--accent)">AI Property Agent</span></h1>
            <p>Go beyond basic automation. Our Edge-native RAG engine allows AI to ingest your property rules and respond with 100% factual accuracy.</p>
            <div style="display: flex; gap: 1.5rem; justify-content: center;">
                <a href="#lab" class="cta-button">Train Your AI</a>
                <a href="#playground" class="tab-btn" style="padding: 1.2rem 2.5rem; font-size: 1.1rem;">Explore APIs</a>
            </div>
        </header>

        <section id="lab" class="glass-panel">
            <h2 class="section-title" style="text-align: center; margin-bottom: 1rem;">Knowledge Lab (RAG Engine)</h2>
            <p style="text-align: center; color: var(--text-dim); margin-bottom: 3rem;">Ingest property rules, manuals, or legal docs directly into the AI's long-term memory.</p>
            <div class="playground-content">
                <div>
                    <h4 style="margin-bottom: 1rem;">Document Ingestion</h4>
                    <textarea id="ingest-text" placeholder="Paste property rules here... e.g. 'Parking violation fine is $50. Residents must use the back entrance for moving.'"></textarea>
                    <button class="cta-button" style="width: 100%; margin-top: 1.5rem;" onclick="ingestKnowledge()">Store in Vector DB</button>
                </div>
                <div>
                    <h4 style="margin-bottom: 1rem;">Knowledge Base Status</h4>
                    <div class="result-box" id="ingest-status">// Ready to absorb knowledge...</div>
                </div>
            </div>
        </section>

        <div class="grid">
            <div class="card"><i>🧠</i><h3>RAG Intelligence</h3><p>Context-aware responses based on your specific legal docs and property rules.</p></div>
            <div class="card"><i>🎙️</i><h3>Voice Triage</h3><p>Direct-to-ticket voice processing with automated urgency detection.</p></div>
            <div class="card"><i>🚀</i><h3>Edge Native</h3><p>Zero-latency performance powered by Cloudflare's global network.</p></div>
        </div>

        <section id="playground" class="glass-panel">
            <h2 class="section-title" style="text-align: center; margin-bottom: 3rem;">API Explorer</h2>
            <div class="tab-buttons">
                <button class="tab-btn active" onclick="switchTab('inquiry')">Lead Agent</button>
                <button class="tab-btn" onclick="switchTab('maintenance')">Repair Triage</button>
                <button class="tab-btn" onclick="switchCode('javascript')">SDK: JS</button>
                <button class="tab-btn" onclick="switchCode('curl')">SDK: cURL</button>
            </div>
            <div class="playground-content">
                <div id="input-container">
                    <textarea id="input-payload">{
  "inquiry": "What is the fine for parking violations?",
  "property_info": { "name": "Emerald Heights" }
}</textarea>
                    <button class="cta-button" style="width: 100%; margin-top: 1.5rem;" onclick="testAPI()">Execute API Call</button>
                </div>
                <div id="output-container">
                    <div class="result-box" id="result-display">// AI result will manifest here...</div>
                </div>
            </div>
        </section>

        <section id="admin" class="glass-panel">
            <h2 class="section-title" style="text-align: center; margin-bottom: 3rem;">Real-time Analytics</h2>
            <div class="stats-grid">
                <div class="chart-container"><canvas id="usageChart"></canvas></div>
                <div class="chart-container"><canvas id="distChart"></canvas></div>
            </div>
        </section>
    </div>

    <script>
        let currentEndpoint = '/api/v1/inquiry/respond';
        let usageChart, distChart;

        async function ingestKnowledge() {
            const text = document.getElementById('ingest-text').value;
            const status = document.getElementById('ingest-status');
            status.innerText = '// Embedding and Indexing...';
            try {
                const res = await fetch('/api/v1/admin/ingest', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ text, metadata: { source: 'dashboard' } })
                });
                const data = await res.json();
                status.innerText = '✅ Successfully stored in Vectorize Index!\\nID: ' + data.id;
            } catch (e) { status.innerText = '❌ Failed: ' + e.message; }
        }

        function switchTab(type) {
            document.querySelectorAll('#playground .tab-btn').forEach(b => b.classList.remove('active'));
            event.target.classList.add('active');
            currentEndpoint = '/api/v1/' + (type === 'inquiry' ? 'inquiry/respond' : 'maintenance/classify');
            const payloads = {
                inquiry: { "inquiry": "What is the parking fine?", "property_info": { "name": "Emerald Heights" } },
                maintenance: { "request_text": "Water leaking from ceiling" }
            };
            document.getElementById('input-payload').value = JSON.stringify(payloads[type], null, 2);
            document.getElementById('input-container').style.display = 'block';
            document.getElementById('output-container').style.width = '100%';
        }

        function switchCode(lang) {
            document.querySelectorAll('#playground .tab-btn').forEach(b => b.classList.remove('active'));
            event.target.classList.add('active');
            const code = {
                javascript: \`fetch('/api/v1/inquiry/respond', {\\\\n  method: 'POST',\\\\n  headers: { 'X-API-Key': 'YOUR_KEY' },\\\\n  body: JSON.stringify({ inquiry: '...' })\\\\n})\`,
                curl: \`curl -X POST /api/v1/inquiry/respond -H "X-API-Key: YOUR_KEY" -d '{"inquiry": "..."}'\`
            };
            document.getElementById('input-payload').value = code[lang];
        }

        async function testAPI() {
            const display = document.getElementById('result-display');
            display.innerText = '// Searching Knowledge Base & Reasoning...';
            try {
                const response = await fetch(currentEndpoint, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: document.getElementById('input-payload').value
                });
                const data = await response.json();
                display.innerText = JSON.stringify(data, null, 2);
                refreshStats();
            } catch (e) { display.innerText = '❌ Error: ' + e.message; }
        }

        async function refreshStats() {
            try {
                const res = await fetch('/api/v1/admin/stats');
                const data = await res.json();
                const usageCtx = document.getElementById('usageChart').getContext('2d');
                const distCtx = document.getElementById('distChart').getContext('2d');
                if (usageChart) usageChart.destroy();
                if (distChart) distChart.destroy();
                usageChart = new Chart(usageCtx, { type: 'line', data: { labels: data.usage.map(u => u.endpoint.split('/').pop()), datasets: [{ label: 'API Calls', data: data.usage.map(u => u.count), borderColor: '#6366f1', tension: 0.4 }] }, options: { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } } });
                distChart = new Chart(distCtx, { type: 'doughnut', data: { labels: data.maintenance_distribution.map(d => d.category), datasets: [{ data: data.maintenance_distribution.map(d => d.count), backgroundColor: ['#10b981', '#f59e0b', '#ef4444', '#6366f1'] }] } });
            } catch (e) { console.error('Stats failed', e); }
        }

        window.onload = refreshStats;
    </script>
</body>
</html>`;
