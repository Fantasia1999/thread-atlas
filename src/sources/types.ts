import type { Session, SessionBundle, SessionSource } from "../../shared/types.js";

export interface ResumeCommandOptions {
  unsafe?: boolean;
}

export interface DetectContext {
  combinedPath: string;
  firstContent: string;
  trimmed: string;
}

export interface SourceAdapter {
  id: SessionSource;
  label: string;
  detect(bundle: SessionBundle, context: DetectContext): boolean;
  parse(bundle: SessionBundle): Session;
  buildResumeCommand?(
    session: Session,
    options?: ResumeCommandOptions
  ): string | null;
}
