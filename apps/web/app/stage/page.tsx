import type { Metadata } from "next";
import { StagePlayer } from "@/components/stage-player";

export const metadata: Metadata = { title: "Stage view" };

export default function StagePage() {
  return <StagePlayer />;
}
