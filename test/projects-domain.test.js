import test from "node:test";
import assert from "node:assert/strict";
import { normalizeProject, normalizeResource, withProjectDerived } from "../lib/projects.js";

test("project keeps independent status and derives progress from tasks", () => {
  const project = normalizeProject({ id: "project-1", name: "发布" });
  const result = withProjectDerived(project, [
    { projectId: project.id, status: "done" },
    { projectId: project.id, status: "cancelled" },
    { projectId: project.id, status: "in_progress" }
  ], []);
  assert.equal(result.status, "planned");
  assert.equal(result.progress, 67);
  assert.equal(result.completedTaskCount, 2);
});

test("project resource accepts GitHub, GitLab, and generic Git metadata", () => {
  assert.equal(normalizeResource({ projectId: "p", resourceType: "github_repository", url: "https://github.com/acme/app" }).resourceType, "github_repository");
  assert.equal(normalizeResource({ projectId: "p", resourceType: "gitlab_repository", url: "https://gitlab.example.com/acme/app", ref: "main" }).ref, "main");
  assert.throws(() => normalizeResource({ projectId: "p", url: "not-a-url" }), /Git URL/);
});
