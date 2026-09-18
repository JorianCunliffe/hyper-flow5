import React, { createContext, useContext, useState } from "react";
export type ProjectScope = {
  projectId: string | null;
  projects: { id: string; name: string }[];
  onProject: (id: string | null) => void;
};
export const ProjectScopeContext = createContext<ProjectScope | null>(null);
export const useProjectScope = () => useContext(ProjectScopeContext);
export function useScopedProject(initial = ""): [string, (id: string) => void] {
  const scope = useProjectScope();
  const [local, setLocal] = useState(initial);
  return scope
    ? [scope.projectId || "", (id) => scope.onProject(id || null)]
    : [local, setLocal];
}
export function ProjectDirectory({ purpose }: { purpose: string }) {
  const scope = useProjectScope();
  if (!scope || scope.projectId) return null;
  return (
    <div className="hf-project-directory">
      <h2>Choose a project</h2>
      <p>{purpose}</p>
      <div>
        {scope.projects.map((project) => (
          <button key={project.id} onClick={() => scope.onProject(project.id)}>
            {project.name}
            <span>Open</span>
          </button>
        ))}
      </div>
      {!scope.projects.length && (
        <p>Create a project using the project menu above to get started.</p>
      )}
    </div>
  );
}
