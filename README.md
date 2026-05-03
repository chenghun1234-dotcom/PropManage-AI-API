# 🏢 PropManage AI API

PropManage AI API is a high-performance B2B service designed for property management companies and landlords. It provides an "AI Property Manager" layer that can be easily integrated into existing apps or websites to automate tenant communication, maintenance triage, and document analysis.

## 🚀 Upgraded Core Features (Premium B2B)

### 1. Smart Lead Qualification API (`POST /api/v1/inquiry/respond`)
- **What it does:** Responds to inquiries AND evaluates lead quality.
- **New Features:** 
    - **Lead Scoring (1-10):** Automatically prioritizes serious tenants.
    - **Intent Analysis:** Understands if the seeker is ready to sign or just browsing.
    - **Auto-Language Detection:** Responds in the tenant's preferred language.

### 2. Maintenance Triage & Cost-Defense API (`POST /api/v1/maintenance/classify`)
- **What it does:** Categorizes requests AND prevents unnecessary technician visits.
- **New Features:**
    - **Self-Check Lists:** Generates 2-3 steps for the tenant to try (e.g., "Check the breaker").
    - **Dispatch Decision:** Boolean flag for whether a pro is actually needed.

### 3. Deep Lease Parsing & Risk API (`POST /api/v1/document/analyze-lease`)
- **What it does:** Extracts data AND identifies legal/financial risks.
- **New Features:**
    - **Atypical Clause Detection:** Flags unusual terms or missing protections.
    - **Compliance Check:** Brief analysis against standard rental regulations.

## 💰 RapidAPI Pricing Strategy

| Tier | Price | Monthly Limit | Features |
| :--- | :--- | :--- | :--- |
| **Basic** | Free | 100 calls | Personal use / Testing |
| **Pro** | $29/mo | 10,000 calls | Small property managers |
| **Ultra** | $99/mo | 50,000 calls | Enterprise, Multi-language |

## 🛠️ Tech Stack
- **Engine:** Cloudflare Workers (Edge-native)
- **AI Model:** Llama 3 (Meta) via Cloudflare Workers AI
- **Runtime:** JavaScript / itty-router
- **Spec:** OpenAPI 3.0

## 📂 Project Structure
- `src/index.js`: Core logic and AI prompting.
- `openapi.json`: API specification for RapidAPI/Swagger.
- `wrangler.toml`: Cloudflare deployment configuration.
- `dashboard/`: (Embedded in index.js) Premium B2B Explorer UI.

---
*Created with Antigravity AI for PropManage AI.*
