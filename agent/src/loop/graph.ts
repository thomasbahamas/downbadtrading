/**
 * graph.ts — LangGraph StateGraph definition.
 *
 * Wires up the 6-node agent loop:
 *   observe → analyze → decide → [execute → report] → monitor → (loop)
 *                                         ↓ (rejected)
 *                                       monitor → (loop)
 */

import { Annotation, StateGraph, END, START } from '@langchain/langgraph';
import type { AgentState, AgentConfig, MarketSnapshot, Portfolio, Position, TradeThesis, RiskApproval, ExecutionResult } from '../types';
import { observeNode } from './observe';
import { analyzeNode } from './analyze';
import { decideNode } from './decide';
import { executeNode } from './execute';
import { reportNode } from './report';
import { monitorNode } from './monitor';
import { createLogger } from '../utils/logger';

const logger = createLogger('graph');

// ─── State annotation ─────────────────────────────────────────────────────

const GraphAnnotation = Annotation.Root({
  marketSnapshot: Annotation<MarketSnapshot | null>({ reducer: (_, b) => b, default: () => null }),
  portfolio: Annotation<Portfolio>({
    reducer: (_, b) => b,
    default: () => ({
      walletAddress: '',
      solBalance: 0,
      usdcBalance: 0,
      totalValueUsd: 0,
      holdings: [],
      dailyPnl: 0,
      dailyPnlPct: 0,
      totalPnl: 0,
      peakValueUsd: 0,
    }),
  }),
  activePositions: Annotation<Position[]>({ reducer: (_, b) => b, default: () => [] }),
  thesis: Annotation<TradeThesis | null>({ reducer: (_, b) => b, default: () => null }),
  riskApproval: Annotation<RiskApproval | null>({ reducer: (_, b) => b, default: () => null }),
  executionResult: Annotation<ExecutionResult | null>({ reducer: (_, b) => b, default: () => null }),
  loopCount: Annotation<number>({ reducer: (_, b) => b, default: () => 0 }),
  lastObserveTime: Annotation<number>({ reducer: (_, b) => b, default: () => 0 }),
  error: Annotation<string | null>({ reducer: (_, b) => b, default: () => null }),
});

type GraphState = typeof GraphAnnotation.State;

// ─── Routing functions ────────────────────────────────────────────────────

function routeAfterDecide(state: GraphState): 'execute' | 'report' | 'monitor' {
  if (!state.riskApproval) {
    logger.warn('routeAfterDecide: riskApproval is null, routing to monitor');
    return 'monitor';
  }

  if (!state.riskApproval.approved) {
    logger.info(`Trade rejected by risk engine: ${state.riskApproval.reason}`);
    return 'monitor';
  }

  if (!state.riskApproval.autoExecute) {
    logger.info('Trade requires manual approval (above max auto size). Routing to report.');
    return 'report';
  }

  return 'execute';
}

// ─── Graph builder ────────────────────────────────────────────────────────

export async function createAgentGraph(agentConfig: AgentConfig) {
  const observe = (state: GraphState) =>
    observeNode(state as AgentState, agentConfig);
  const analyze = (state: GraphState) =>
    analyzeNode(state as AgentState, agentConfig);
  const decide = (state: GraphState) => decideNode(state as AgentState, agentConfig);
  const execute = (state: GraphState) => executeNode(state as AgentState, agentConfig);
  const report = (state: GraphState) => reportNode(state as AgentState, agentConfig);
  const monitor = (state: GraphState) => monitorNode(state as AgentState, agentConfig);

  // Chain all node and edge additions for proper type inference
  const compiled = new StateGraph(GraphAnnotation)
    .addNode('observe', observe)
    .addNode('analyze', analyze)
    .addNode('decide', decide)
    .addNode('execute', execute)
    .addNode('report', report)
    .addNode('monitor', monitor)
    .addEdge(START, 'observe')
    .addEdge('observe', 'analyze')
    .addEdge('analyze', 'decide')
    .addConditionalEdges('decide', routeAfterDecide, {
      execute: 'execute',
      report: 'report',
      monitor: 'monitor',
    })
    .addEdge('execute', 'report')
    .addEdge('report', 'monitor')
    .addEdge('monitor', END)
    .compile();

  return compiled;
}

// ─── Initial state factory ────────────────────────────────────────────────

export function createInitialState(walletAddress: string): AgentState {
  return {
    marketSnapshot: null,
    portfolio: {
      walletAddress,
      solBalance: 0,
      usdcBalance: 0,
      totalValueUsd: 0,
      holdings: [],
      dailyPnl: 0,
      dailyPnlPct: 0,
      totalPnl: 0,
      peakValueUsd: 0,
    },
    activePositions: [],
    thesis: null,
    riskApproval: null,
    executionResult: null,
    loopCount: 0,
    lastObserveTime: 0,
    error: null,
  };
}
