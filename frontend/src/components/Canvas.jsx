import { useEffect, useMemo, useState } from "react";
import ReactFlow, { Background, Controls, MiniMap, MarkerType } from "reactflow";
import "reactflow/dist/style.css";
import { useSessionStore } from "../store/sessionStore";
import AgentNode from "./AgentNode";
import MasterAgentNode from "./MasterAgentNode";

const NODE_TYPES = {
  master: MasterAgentNode,
  agent: AgentNode,
};

export default function Canvas({ onRetryAgent }) {
  const agents = useSessionStore((s) => s.agents);
  const masterStatus = useSessionStore((s) => s.masterStatus);
  const setDrawerAgent = useSessionStore((s) => s.setDrawerAgent);
  const selectedAgentId = useSessionStore((s) => s.selectedAgentId);
  const setSelectedAgent = useSessionStore((s) => s.setSelectedAgent);
  const addCustomAgent = useSessionStore((s) => s.addCustomAgent);
  const deleteAgent = useSessionStore((s) => s.deleteAgent);
  const isRunning = useSessionStore((s) => s.isRunning);
  const [positions, setPositions] = useState({});

  useEffect(() => {
    setPositions((prev) => {
      const width = 900;
      const radius = 300;
      const centerX = width / 2;
      const centerY = 300;
      const next = { ...prev };
      agents.forEach((agent, index) => {
        if (next[agent.id]) return;
        const total = Math.max(agents.length, 1);
        const theta = Math.PI * (index / Math.max(total - 1, 1));
        const x = centerX - radius * Math.cos(theta) - 150;
        const y = centerY + radius * Math.sin(theta);
        next[agent.id] = { x, y };
      });
      Object.keys(next).forEach((agentId) => {
        if (!agents.find((agent) => agent.id === agentId)) delete next[agentId];
      });
      return next;
    });
  }, [agents]);

  const { nodes, edges } = useMemo(() => {
    const width = 900;
    const radius = 300;
    const centerX = width / 2;
    const centerY = 300;

    const masterNode = {
      id: "master",
      type: "master",
      position: { x: centerX - 150, y: 30 },
      data: { status: masterStatus, active: /Thinking|Orchestrating|synthesizing/i.test(masterStatus) },
      draggable: false,
    };

    const agentNodes = agents.map((agent) => {
      const position = positions[agent.id] ?? { x: centerX, y: centerY };
      return {
        id: agent.id,
        type: "agent",
        position,
        data: { ...agent, isRunning, onRetry: onRetryAgent },
        selected: selectedAgentId === agent.id,
      };
    });

    const masterEdges = agents.map((agent) => ({
      id: `edge_master_${agent.id}`,
      source: "master",
      sourceHandle: "out",
      target: agent.id,
      targetHandle: "in",
      animated: agent.status === "speaking",
      markerEnd: { type: MarkerType.ArrowClosed },
      style: { stroke: agent.color, strokeWidth: 2 },
    }));

    return { nodes: [masterNode, ...agentNodes], edges: masterEdges };
  }, [agents, masterStatus, isRunning, onRetryAgent, positions, selectedAgentId]);

  return (
    <div className="relative mx-6 mt-4 h-[68vh] rounded-2xl border border-zinc-700 bg-zinc-950">
      <div className="absolute left-3 top-3 z-20 flex gap-2">
        <button
          type="button"
          className="rounded border border-zinc-600 bg-zinc-900/80 px-2 py-1 text-xs text-zinc-200 hover:bg-zinc-800"
          onClick={addCustomAgent}
        >
          + Add agent
        </button>
        <button
          type="button"
          disabled={!selectedAgentId}
          className="rounded border border-zinc-600 bg-zinc-900/80 px-2 py-1 text-xs text-zinc-200 hover:bg-zinc-800 disabled:opacity-50"
          onClick={() => selectedAgentId && deleteAgent(selectedAgentId)}
        >
          Delete selected
        </button>
      </div>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        fitView
        onNodeDragStop={(_, node) => {
          if (node.id === "master") return;
          setPositions((prev) => ({ ...prev, [node.id]: node.position }));
        }}
        onNodeClick={(_, node) => {
          if (node.id !== "master") {
            setSelectedAgent(node.id);
            setDrawerAgent(node.id);
          }
        }}
      >
        <MiniMap pannable zoomable className="!bg-zinc-900" />
        <Controls />
        <Background color="#2b2b2b" gap={24} />
      </ReactFlow>
    </div>
  );
}
