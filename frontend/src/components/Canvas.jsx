import { useMemo } from "react";
import ReactFlow, { Background, Controls, MiniMap, MarkerType } from "reactflow";
import "reactflow/dist/style.css";
import { useSessionStore } from "../store/sessionStore";
import AgentNode from "./AgentNode";
import MasterAgentNode from "./MasterAgentNode";

const nodeTypes = {
  master: MasterAgentNode,
  agent: AgentNode,
};

export default function Canvas() {
  const agents = useSessionStore((s) => s.agents);
  const masterStatus = useSessionStore((s) => s.masterStatus);
  const setDrawerAgent = useSessionStore((s) => s.setDrawerAgent);

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

    const agentNodes = agents.map((agent, index) => {
      const total = Math.max(agents.length, 1);
      const theta = Math.PI * (index / Math.max(total - 1, 1));
      const x = centerX - radius * Math.cos(theta) - 150;
      const y = centerY + radius * Math.sin(theta);
      return {
        id: agent.id,
        type: "agent",
        position: { x, y },
        data: agent,
      };
    });

    const masterEdges = agents.map((agent) => ({
      id: `edge_master_${agent.id}`,
      source: "master",
      target: agent.id,
      animated: agent.status === "speaking",
      markerEnd: { type: MarkerType.ArrowClosed },
      style: { stroke: agent.color, strokeWidth: 2 },
    }));

    return { nodes: [masterNode, ...agentNodes], edges: masterEdges };
  }, [agents, masterStatus]);

  return (
    <div className="mx-6 mt-4 h-[68vh] rounded-2xl border border-zinc-700 bg-zinc-950">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        onNodeClick={(_, node) => {
          if (node.id !== "master") setDrawerAgent(node.id);
        }}
      >
        <MiniMap pannable zoomable className="!bg-zinc-900" />
        <Controls />
        <Background color="#2b2b2b" gap={24} />
      </ReactFlow>
    </div>
  );
}
