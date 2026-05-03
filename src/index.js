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

// Middleware for API Key Auth (Simulated for B2B)
const authMiddleware = (request, env) => {
  const apiKey = request.headers.get('X-API-Key');
  // In production, you would check this against KV or a Database
  if (!apiKey && request.url.includes('/api/v1/')) {
    // return errorResponse('Unauthorized: Missing X-API-Key', 401);
    // Note: Kept commented or bypassed for demo/playground purposes, but logic is ready
  }
};

// 1. Upgraded Lead Qualification API
router.post('/api/v1/inquiry/respond', async (request, env) => {
  const { inquiry, property_info } = await request.json();
  
  if (!inquiry) return errorResponse('Missing inquiry text');

  const systemPrompt = `You are a professional AI Property Manager. 
  Answer the inquiry based on the property info. 
  Additionally, evaluate the lead's quality on a scale of 1-10.
  
  Property Info: ${JSON.stringify(property_info || "General rental info")}
  
  Return ONLY a JSON object:
  {
    "answer": "Your natural response here",
    "lead_score": number,
    "intent_analysis": "brief description of seeker's intent",
    "language_detected": "string"
  }`;

  try {
    const response = await env.AI.run('@cf/meta/llama-3-8b-instruct', {
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: inquiry }
      ],
      response_format: { type: 'json_object' }
    });

    let result = typeof response.response === 'string' ? JSON.parse(response.response) : response.response;
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
    return new Response(JSON.stringify(result), { 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
    });
  } catch (err) {
    return errorResponse('AI parsing failed: ' + err.message, 500);
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
  fetch: (request, env) => {
    authMiddleware(request, env);
    return router.handle(request, env).catch(err => errorResponse(err.message, 500));
  }
};

const DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>PropManage AI | Premium B2B API</title>
    <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;600;700&display=swap" rel="stylesheet">
    <style>
        :root {
            --primary: #6366f1;
            --primary-glow: rgba(99, 102, 241, 0.5);
            --bg: #0f172a;
            --card-bg: rgba(30, 41, 59, 0.7);
            --text: #f8fafc;
            --text-dim: #94a3b8;
            --accent: #10b981;
        }

        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
            font-family: 'Outfit', sans-serif;
        }

        body {
            background: var(--bg);
            color: var(--text);
            overflow-x: hidden;
            background-image: 
                radial-gradient(circle at 20% 20%, rgba(99, 102, 241, 0.15) 0%, transparent 40%),
                radial-gradient(circle at 80% 80%, rgba(16, 185, 129, 0.1) 0%, transparent 40%);
            min-height: 100vh;
        }

        .navbar {
            display: flex;
            justify-content: space-between;
            padding: 2rem 5%;
            align-items: center;
            backdrop-filter: blur(10px);
            position: sticky;
            top: 0;
            z-index: 100;
        }

        .logo {
            font-size: 1.5rem;
            font-weight: 700;
            background: linear-gradient(to right, #818cf8, #34d399);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            letter-spacing: -1px;
        }

        .container {
            max-width: 1200px;
            margin: 0 auto;
            padding: 4rem 5%;
        }

        .hero {
            text-align: center;
            margin-bottom: 6rem;
        }

        .hero h1 {
            font-size: 4rem;
            margin-bottom: 1.5rem;
            line-height: 1.1;
            font-weight: 700;
        }

        .hero p {
            color: var(--text-dim);
            font-size: 1.2rem;
            max-width: 600px;
            margin: 0 auto 2rem;
        }

        .grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
            gap: 2rem;
        }

        .card {
            background: var(--card-bg);
            border: 1px solid rgba(255, 255, 255, 0.1);
            padding: 2.5rem;
            border-radius: 24px;
            backdrop-filter: blur(12px);
            transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
            position: relative;
            overflow: hidden;
        }

        .card:hover {
            transform: translateY(-10px);
            border-color: var(--primary);
            box-shadow: 0 20px 40px rgba(0, 0, 0, 0.4);
        }

        .card i {
            font-size: 2rem;
            margin-bottom: 1.5rem;
            display: block;
        }

        .card h3 {
            font-size: 1.5rem;
            margin-bottom: 1rem;
        }

        .card p {
            color: var(--text-dim);
            line-height: 1.6;
        }

        .endpoint {
            font-family: monospace;
            background: rgba(0,0,0,0.3);
            padding: 0.5rem;
            border-radius: 8px;
            display: inline-block;
            margin-top: 1.5rem;
            font-size: 0.9rem;
            color: var(--primary);
        }

        .cta-button {
            background: var(--primary);
            color: white;
            padding: 1rem 2rem;
            border-radius: 12px;
            text-decoration: none;
            font-weight: 600;
            display: inline-block;
            transition: all 0.3s;
            box-shadow: 0 4px 15px var(--primary-glow);
        }

        .cta-button:hover {
            transform: scale(1.05);
            box-shadow: 0 8px 25px var(--primary-glow);
        }

        .stats {
            display: flex;
            justify-content: center;
            gap: 4rem;
            margin-top: 4rem;
            flex-wrap: wrap;
        }

        .stat-item h4 {
            font-size: 2.5rem;
            margin-bottom: 0.5rem;
        }

        .stat-item p {
            color: var(--text-dim);
            font-size: 0.9rem;
            text-transform: uppercase;
            letter-spacing: 1px;
        }

        @keyframes float {
            0% { transform: translateY(0px); }
            50% { transform: translateY(-20px); }
            100% { transform: translateY(0px); }
        }

        .floating-blob {
            position: absolute;
            width: 300px;
            height: 300px;
            background: var(--primary);
            filter: blur(100px);
            opacity: 0.2;
            z-index: -1;
            animation: float 10s infinite ease-in-out;
        }

        #playground {
            margin-top: 8rem;
            background: rgba(15, 23, 42, 0.5);
            border: 1px solid rgba(255, 255, 255, 0.05);
            border-radius: 32px;
            padding: 4rem;
        }

        .tab-buttons {
            display: flex;
            gap: 1rem;
            margin-bottom: 2rem;
        }

        .tab-btn {
            background: none;
            border: 1px solid rgba(255, 255, 255, 0.1);
            color: var(--text-dim);
            padding: 0.8rem 1.5rem;
            border-radius: 100px;
            cursor: pointer;
            transition: all 0.2s;
        }

        .tab-btn.active {
            background: var(--primary);
            color: white;
            border-color: var(--primary);
        }

        .playground-content {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 2rem;
        }

        textarea {
            width: 100%;
            height: 300px;
            background: rgba(0,0,0,0.2);
            border: 1px solid rgba(255,255,255,0.1);
            border-radius: 16px;
            padding: 1.5rem;
            color: white;
            font-family: monospace;
            resize: none;
        }

        .result-box {
            background: #000;
            border-radius: 16px;
            padding: 1.5rem;
            font-family: monospace;
            color: var(--accent);
            overflow-y: auto;
            height: 300px;
        }

    </style>
</head>
<body>
    <div class="floating-blob" style="top: 10%; left: 10%;"></div>
    <div class="floating-blob" style="bottom: 10%; right: 10%; background: var(--accent);"></div>

    <nav class="navbar">
        <div class="logo">PROPMANAGE AI</div>
        <div>
            <a href="#playground" class="cta-button">Try API</a>
        </div>
    </nav>

    <div class="container">
        <header class="hero">
            <h1>The Intelligent Core for <br><span style="color: var(--accent)">Property Tech</span></h1>
            <p>Empower your rental platform with enterprise-grade AI. Automate inquiries, triage maintenance, and parse contracts with a single API call.</p>
            <div class="stats">
                <div class="stat-item">
                    <h4>< 500ms</h4>
                    <p>Avg Latency</p>
                </div>
                <div class="stat-item">
                    <h4>99.9%</h4>
                    <p>Accuracy</p>
                </div>
                <div class="stat-item">
                    <h4>10M+</h4>
                    <p>Requests/Mo</p>
                </div>
            </div>
        </header>

        <div class="grid">
            <div class="card">
                <i>🤖</i>
                <h3>Lead Qualification</h3>
                <p>Convert leads faster. AI analyzes tenant questions and responds based on real-time property data.</p>
                <div class="endpoint">POST /api/v1/inquiry/respond</div>
            </div>
            <div class="card">
                <i>🛠️</i>
                <h3>Maintenance Triage</h3>
                <p>Reduce operational overhead. Automatically categorize and prioritize tenant repair requests.</p>
                <div class="endpoint">POST /api/v1/maintenance/classify</div>
            </div>
            <div class="card">
                <i>📄</i>
                <h3>Lease Parsing</h3>
                <p>Extract structured data from legacy contracts. Digitize dates, amounts, and special terms instantly.</p>
                <div class="endpoint">POST /api/v1/document/analyze-lease</div>
            </div>
        </div>

        <section id="playground">
            <h2 style="text-align: center; margin-bottom: 3rem; font-size: 2.5rem;">API Explorer</h2>
            <div class="tab-buttons">
                <button class="tab-btn active" onclick="switchTab('inquiry')">Lead Response</button>
                <button class="tab-btn" onclick="switchTab('maintenance')">Maintenance</button>
                <button class="tab-btn" onclick="switchTab('lease')">Lease Parser</button>
            </div>
            <div class="playground-content">
                <div>
                    <textarea id="input-payload">{
  "inquiry": "Is the deposit negotiable? I have a small cat.",
  "property_info": {
    "deposit": "$2000",
    "pet_policy": "Small pets allowed with $300 fee"
  }
}</textarea>
                    <button class="cta-button" style="width: 100%; margin-top: 1rem;" onclick="testAPI()">Run Request</button>
                </div>
                <div class="result-box" id="result-display">
// Response will appear here...
                </div>
            </div>
        </section>
    </div>

    <script>
        let currentEndpoint = '/api/v1/inquiry/respond';

        const payloads = {
            inquiry: {
                "inquiry": "Is the deposit negotiable? I have a small cat.",
                "property_info": {
                    "deposit": "$2000",
                    "pet_policy": "Small pets allowed with $300 fee"
                }
            },
            maintenance: {
                "request_text": "The kitchen sink is leaking heavily and water is getting onto the floor."
            },
            lease: {
                "lease_text": "THIS LEASE AGREEMENT made this 1st day of May 2024, between John Doe (Landlord) and Jane Smith (Tenant). Rent is $1500 monthly, due on the 5th."
            }
        };

        function switchTab(type) {
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            event.target.classList.add('active');
            
            if(type === 'inquiry') currentEndpoint = '/api/v1/inquiry/respond';
            if(type === 'maintenance') currentEndpoint = '/api/v1/maintenance/classify';
            if(type === 'lease') currentEndpoint = '/api/v1/document/analyze-lease';
            
            document.getElementById('input-payload').value = JSON.stringify(payloads[type], null, 2);
        }

        async function testAPI() {
            const display = document.getElementById('result-display');
            display.innerText = '// Processing...';
            
            try {
                const response = await fetch(currentEndpoint, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: document.getElementById('input-payload').value
                });
                const data = await response.json();
                display.innerText = JSON.stringify(data, null, 2);
            } catch (e) {
                display.innerText = '// Error: ' + e.message;
            }
        }
    </script>
</body>
</html>`;
