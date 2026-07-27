export interface AgentRequest {
  readonly prompt: string;
}

export interface AgentResult {
  readonly provider: string;
  readonly content: string;
}

export interface AgentAdapter {
  readonly name: string;
  ready(): Promise<boolean>;
  invoke(request: AgentRequest): Promise<AgentResult>;
}

export interface GenerationRequest {
  readonly prompt: string;
  readonly outputIndex: number;
}

export interface GenerationResult {
  readonly provider: string;
  readonly mediaType: string;
  readonly contentId: string;
  readonly uri: string;
}

export interface GenerationAdapter {
  readonly name: string;
  ready(): Promise<boolean>;
  generate(request: GenerationRequest): Promise<GenerationResult>;
}
