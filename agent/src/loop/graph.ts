/**
 * graph.ts — LangGraph StateGraph definition.
 *
 * Wires up the 6-node agent loop:
 *   observe → analyze → decide → [execute → report] → monitor → (loop)
 *                                         ↓ (rejected)
 *                                       monitor → (loop)
 */

import { StateGraph, END, START } from '@langchain/langgraph';
import { RunnableConfig } from '@langchain/core/runnables';
import type { AgentState, AgentConfig } from '../types';
import { observeNode } from './observe';
import { analyzeNode } from './analyze';
import { decideNode } from './decide';
import { executeNode } from './execute';
import { reportNode } from './report';
import { monitorNode } from './monitor';
import { createLogger } from '../utils/logger';

const logger = createLogger('graph');

// ─── State annotation ─────────────────────────────────────────────────────
// LangGraph uses a reducer-based state; we define all keys here.

// We pass state as a plain object — LangGraph merges return values.
// All fields are optional in the graph; the initial state sets defaults.

type GraphState = AgentState;

// ─── Routing functions ────────────────────────────────────────────────────

/**
 * After DECIDE: if risk approved AND auto-execute, go to EXECUTE.
 * If approved but needs manual approval, go to REPORT (which sends Telegram request).
 * If rejected, skip to MONITOR.
 */
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
    // Above MAX_AUTO_TRADE_USD — send approval request via Telegram first
    logger.info('Trade requires manual approval (above max auto size). Routing to report.');
    return 'report';
  }

  return 'execute';
}

/**
 * After EXECUTE: always go to REPORT (success or failure).
 */
function routeAfterExecute(_state: GraphState): 'report' {
  return 'report';
}

/**
 * After REPORT: always go to MONITOR.
 */
function routeAfterReport(_state: GraphState): 'monitor' {
  return 'monitor';
}

/**
 * After MONITOR: always loop back to OBSERVE (the graph itself is the loop).
 * The index.ts scheduler controls inter-loop sleep.
 */
function routeAfterMonitor(_state: GraphState): typeof END {
  return END;
}

// ─── Graph builder ────────────────────────────────────────────────────────

export async function createAgentGraph(agentConfig: AgentConfig) {
  // Build node functions with injected config
  const observe = (state: GraphState, runConfig?: RunnableConfig) =>
    observeNode(state, agentConfig, runConfig);
  const analyze = (state: GraphState, runConfig?: RunnableConfig) =>
    analyzeNode(state, agentConfig, runConfig);
  const decide = (state: GraphState) => decideNode(state, agentConfig);
  const execute = (state: GraphState) => executeNode(state, agentConfig);
  const report = (state: GraphState) => reportNode(state, agentConfig);
  const monitor = (state: GraphState) => monitorNode(state, agentConfig);

  const workflow = new StateGraph<GraphState>({
    channels: {
      marketSnapshot: { default: () => null },
      portfolio: {
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
      },
      activePositions: { default: () => [] },
      thesis: { default: () => null },
      riskApproval: { default: () => null },
      executionResult: { default: () => null },
      loopCount: { default: () => 0 },
      lastObserveTime: { default: () => 0 },
      error: { default: () => null },
    },
  });

  // Register nodes
  workflow.addNode('observe', observe);
  workflow.addNode('analyze', analyze);
  workflow.addNode('decide', decide);
  workflow.addNode('execute', execute);
  workflow.addNode('report', report);
  workflow.addNode('monitor', monitor);

  // Edges
  workflow.addEdge(START, 'observe');
  workflow.addEdge('observe', 'analyze');
  workflow.addEdge('analyze', 'decide');

  workflow.addConditionalEdges('decide', routeAfterDecide, {
    execute: 'execute',
    report: 'report',  // approval request path
    monitor: 'monitor',
  });

  workflow.addConditionalEdges('execute', routeAfterExecute, {
    report: 'report',
  });

  workflow.addConditionalEdges('report', routeAfterReport, {
    monitor: 'monitor',
  });

  workflow.addConditionalEdges('monitor', routeAfterMonitor, {
    [END]: END,
  });

  return workflow.compile();
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
