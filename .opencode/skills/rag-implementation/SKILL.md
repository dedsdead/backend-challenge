---
name: rag-implementation
description: "RAG (Retrieval-Augmented Generation) implementation workflow covering embedding selection, vector database setup, chunking strategies, and retrieval optimization. Use during /pwf-work or /pwf-work-plan when implementing RAG systems."
category: domain-convention
risk: safe
source: psters-workflow
date_added: "2026-02-27"
---

# RAG Implementation Workflow

## Overview

Specialized workflow for implementing RAG (Retrieval-Augmented Generation) systems including embedding model selection, vector database setup, chunking strategies, retrieval optimization, and evaluation.

## When to Use This Workflow

Use this workflow when:
- Building RAG-powered applications
- Implementing semantic search
- Creating knowledge-grounded AI
- Setting up document Q&A systems
- Optimizing retrieval quality

## Agent Integration

This workflow uses specialized RAG agents from `.opencode/agents/research/`:

- `rag-embedding-strategist` - Embedding model selection and evaluation
- `rag-vector-database-architect` - Vector DB schema and indexing design
- `rag-chunking-specialist` - Chunking strategies for different content types
- `rag-retrieval-optimizer` - Hybrid search, reranking, query expansion
- `rag-evaluation-specialist` - Retrieval and generation metrics

## Workflow Phases

### Phase 1: Requirements Analysis

#### Agents to Invoke
- `rag-engineer` skill - RAG engineering patterns
- Project docs in `docs/` for context

#### Actions
1. Define use case and query patterns
2. Identify data sources and content types
3. Set accuracy requirements (recall, precision)
4. Determine latency targets
5. Plan evaluation metrics

### Phase 2: Embedding Selection

#### Agents to Invoke
- `rag-embedding-strategist` - Embedding model selection

#### Actions
1. Evaluate embedding models for content type
2. Test domain relevance
3. Measure embedding quality
4. Consider cost/latency trade-offs
5. Select model with rationale

### Phase 3: Vector Database Setup

#### Agents to Invoke
- `rag-vector-database-architect` - Vector DB architecture

#### Actions
1. Choose vector database (Pinecone, Weaviate, ChromaDB, pgvector)
2. Design schema and metadata structure
3. Configure indexes (HNSW, IVF)
4. Set up connection and authentication
5. Test basic queries

### Phase 4: Chunking Strategy

#### Agents to Invoke
- `rag-chunking-specialist` - Chunking strategies
- `rag-engineer` skill - Chunking patterns

#### Actions
1. Choose chunking approach (semantic, hierarchical)
2. Implement chunking with boundary detection
3. Add overlap handling for context continuity
4. Create metadata schema
5. Test retrieval quality with sample queries

### Phase 5: Retrieval Implementation

#### Agents to Invoke
- `rag-retrieval-optimizer` - Retrieval pipeline design
- `rag-engineer` skill - Retrieval patterns

#### Actions
1. Implement vector search
2. Add keyword search (BM25/TF-IDF)
3. Configure hybrid search with Reciprocal Rank Fusion
4. Set up reranking (cross-encoder)
5. Optimize latency and caching

### Phase 6: LLM Integration

#### Actions
1. Select LLM provider (OpenAI, Anthropic, open-source)
2. Design prompt template with context injection
3. Implement citation handling
4. Add context compression if needed
5. Test generation quality

### Phase 7: Caching

#### Actions
1. Implement response caching
2. Set up embedding cache
3. Configure TTL and invalidation
4. Monitor cache hit rates
5. Optimize cache key strategy

### Phase 8: Evaluation

#### Agents to Invoke
- `rag-evaluation-specialist` - Evaluation metrics and test design

#### Actions
1. Define evaluation metrics (MRR, NDCG, Recall@K)
2. Create test dataset with labeled relevant docs
3. Measure retrieval accuracy separately
4. Evaluate generation quality (faithfulness, relevance)
5. Iterate on improvements based on metrics

## RAG Architecture

```
User Query -> Embedding -> Vector Search -> Retrieved Docs -> LLM -> Response
                 |              |              |              |
             Model         Vector DB     Chunk Store    Prompt + Context
```

## Quality Gates

- [ ] Embedding model selected with rationale
- [ ] Vector DB configured and tested
- [ ] Chunking implemented with metadata
- [ ] Retrieval pipeline working (vector + keyword + hybrid)
- [ ] LLM integrated with context injection
- [ ] Evaluation metrics defined and baseline measured

## Workflow Integration

- During `/pwf-brainstorm`: Invoke RAG agents in parallel to explore architecture options
- During `/pwf-plan`: Reference this workflow for RAG implementation tasks
- During `/pwf-work` or `/pwf-work-plan`: Follow phases sequentially, invoking relevant agents

For complex RAG architecture decisions, use `orchestrating-multi-agents` skill to run RAG agents in parallel.

## Related Skills

- `rag-engineer` - RAG patterns and best practices
- `orchestrating-multi-agents` - Parallel agent orchestration for complex decisions

## Limitations
- Use this skill only when the task clearly matches the scope described above.
- Do not treat the output as a substitute for environment-specific validation, testing, or expert review.
- Stop and ask for clarification if required inputs, permissions, safety boundaries, or success criteria are missing.
