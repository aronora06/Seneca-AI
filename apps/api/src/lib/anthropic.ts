import Anthropic from "@anthropic-ai/sdk";
import { env } from "../env.js";

export const anthropic = new Anthropic({ apiKey: env.anthropicApiKey });

export const ANTHROPIC_MAX_TOKENS = 2048;
