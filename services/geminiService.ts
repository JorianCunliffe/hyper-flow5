
import { ProjectType } from "../types";
import { firebaseService } from './firebaseService';

export class GeminiService {
  async generateProjectStructure(name: string, type: ProjectType) {
    try {
      const response = await firebaseService.authorizedFetch("/api/gemini/generateProjectStructure", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, type })
      });
      if (!response.ok) return null;
      return await response.json();
    } catch (e) {
      console.error("Failed to parse AI response", e);
      return null;
    }
  }

  async brainstormSubtasks(milestoneName: string, projectContext: string) {
    try {
      const response = await firebaseService.authorizedFetch("/api/gemini/brainstormSubtasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ milestoneName, projectContext })
      });
      if (!response.ok) return [];
      return await response.json();
    } catch (e) {
      return [];
    }
  }
}

export const geminiService = new GeminiService();
