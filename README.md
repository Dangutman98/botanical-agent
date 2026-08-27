# 🌿 Botanical AI Agent - Hebrew Botanical & Medical RAG System 🧠

> ⚠️ **Project Status: Active Development** — This project is currently in active development. Features and knowledge base are constantly being updated and optimized.

### 🌐 Live Demo
Experience the live application here: **[botanical-agent.vercel.app](https://botanical-agent.vercel.app/)** 🚀

---

## 📖 Background & Overview
The **Botanical AI Agent** is a state-of-the-art Retrieval-Augmented Generation (RAG) system specialized in botanical medicine, herbal remedies, and clinical nutrition in Hebrew. 

Finding reliable, evidence-based natural medicine data in Hebrew is notoriously difficult. This application solves this by crawling professional, trusted databases, chunking and embedding the content, and serving it via a highly accurate hybrid search RAG pipeline. Users can chat with the agent in natural Hebrew, asking about specific plants, formulas, or medical conditions, and receive scientifically-backed answers complete with source citations.

---

## 🛠️ Architecture & Tech Stack

The architecture is built for speed, accuracy, and cost-efficiency:

*   **Frontend & Application Layer:** Next.js (app router) styled with premium glassmorphism Vanilla CSS.
*   **AI Engine & LLM:** Powered by ultra-fast **Groq LLMs** (using Llama 3 models) for near-instant responses.
*   **Vector Search & DB:** **Pinecone** Serverless vector database storing 384-dimensional dense semantic vectors.
*   **Local Retrieval:** A custom **Hebrew-optimized BM25 engine** executing on local JSON caches to handle keyword matches.
*   **Hybrid Search Fusion:** Implements Reciprocal Rank Fusion (RRF) to merge dense semantic search (from HuggingFace embeddings) with local sparse keyword search (BM25), ensuring maximum retrieval accuracy.
*   **Serverless Deployment:** Ingestion pipeline and background embedding tasks are containerized via **Docker** and deployed on **AWS Lambda** (using Terraform infrastructure as code) to achieve zero cold starts and infinite scalability.
*   **CI/CD Pipeline:** Fully automated deployments using **GitHub Actions**.

---

## 📊 Knowledge Base Stats
Our automated crawler index targets 6 major clinical and botanical databases:
*   `bara.co.il` — Hebrew Western & Chinese herbal medicine and indexes.
*   `trifolium.co.il` — Professional clinical herbal pharmacy blog and formulas.
*   `naturopedia.com` — Comprehensive natural medicine and pathology encyclopedia.
*   `nccih.nih.gov` — NIH National Center for Complementary and Integrative Health (USA).
*   `medlineplus.gov` — US National Library of Medicine.

**Current Database Size:** **Over 12,000 document chunks** successfully indexed across all sources.

---

## ⚡ How to Run Locally

### 1. Clone & Install Dependencies
```bash
git clone https://github.com/Dangutman98/botanical-agent.git
cd botanical-agent
npm install
```

### 2. Set Up Environment Variables
Create a `.env.local` file in the root directory:
```env
PINECONE_API_KEY=your_pinecone_key
PINECONE_HOST=your_pinecone_index_host
GROQ_API_KEY=your_groq_api_key
HF_TOKEN=your_huggingface_token  # For semantic embeddings
```

### 3. Run the Development Server
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) to view the application.

### 4. Run the Crawler & Rebuild Cache (Optional)
The crawler is a standalone crawl-and-validate pass — it doesn't need the dev server running
and doesn't call any embedding API. It writes validated chunks to `data/crawled-chunks.jsonl`
as it goes (safe to interrupt) and compacts them into `lib/rag/chunks.json` at the end:
```bash
npx tsx scripts/crawl-all.ts
```
If a run was interrupted before compacting, finish it without re-crawling:
```bash
npx tsx scripts/crawl-all.ts --compact
```

---

## 🤝 Contact & Portfolio
Designed and built by **Dan Gutman** as a showcase project for my personal portfolio. Feel free to reach out or explore the repository! 🌟
