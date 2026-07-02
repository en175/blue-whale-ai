"use client";

import styled from "@emotion/styled";
import { Sparkles } from "lucide-react";

const Capsule = styled.a`
  display: inline-flex;
  align-items: center;
  gap: 8px;
  height: 30px;
  padding: 0 12px;
  border-radius: 9999px;
  background: rgba(255, 255, 255, 0.07);
  border: 1px solid rgba(255, 255, 255, 0.1);
  color: rgba(255, 255, 255, 0.78);
  font-size: 12px;
  line-height: 1;
  text-decoration: none;
  transition: background-color 200ms ease, border-color 200ms ease,
    color 200ms ease;

  &:hover {
    background: rgba(255, 255, 255, 0.1);
    border-color: rgba(255, 255, 255, 0.16);
    color: rgba(255, 255, 255, 0.92);
  }
`;

const Icon = styled(Sparkles)`
  width: 10px;
  height: 10px;
  flex-shrink: 0;
  color: rgba(255, 255, 255, 0.75);
`;

const Segment = styled.span`
  color: rgba(255, 255, 255, 0.55);
`;

const Highlight = styled.span`
  color: rgba(255, 255, 255, 0.92);
  font-weight: 500;
`;

export default function PromoCapsule() {
  return (
    <Capsule href="#" className="mb-5">
      <Icon />
      <span>
        <Highlight>Seedance 2.0 </Highlight>
        <Highlight>$0.1/s</Highlight>
        <Segment>, Mini </Segment>
        <Highlight>$0.05/s</Highlight>
        <Segment> ｜365 days of Unlimited </Segment>
        <Highlight>Seedance 2.0 Mini</Highlight>
        <Segment> &amp; </Segment>
        <Highlight>GPT Image 2</Highlight>
      </span>
    </Capsule>
  );
}
