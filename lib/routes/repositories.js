import { credentialKey } from "../credentials.js";
import { decryptSecret } from "../credentials.js";
import {
  bindRepositoryResource, disconnectConnection, normalizeConnection, publicConnection,
  publicRepository, replaceProjectBinding, upsertCatalogEntry
} from "../repositories.js";
import { requireWorkspaceManagement, workspaceCapabilities } from "../permissions.js";

const asyncH = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function loadRepos(ctx, req) {
  if (!ctx.persistence.repositories) return { connections: [], repositories: [] };
  return ctx.persistence.repositories.load(req.context);
}

function saveRepos(ctx, req, state) {
  return ctx.persistence.repositories.save(req.context, state);
}

function currentConnection(state, id) {
  const connection = state.connections.find((item) => item.id === id);
  if (!connection) throw Object.assign(new Error("连接不存在"), { statusCode: 404, code: "CONNECTION_NOT_FOUND" });
  return connection;
}

export function register(app, ctx) {
  app.get("/api/connections/github/install", asyncH(async (req, res) => {
    const slug = ctx.config?.githubAppSlug || "";
    const workspaceId = req.context?.workspace?.id || "";
    res.json({
      configured: Boolean(slug),
      installUrl: slug
        ? `https://github.com/apps/${encodeURIComponent(slug)}/installations/new${workspaceId ? `?state=${encodeURIComponent(workspaceId)}` : ""}`
        : null
    });
  }));

  app.get("/api/connections", asyncH(async (req, res) => {
    const state = await loadRepos(ctx, req);
    res.json({ connections: state.connections.map(publicConnection) });
  }));

  app.post("/api/connections", asyncH(async (req, res) => {
    requireWorkspaceManagement(req.context, "仅空间管理员可以管理代码连接");
    const providers = ctx.gitProviders;
    const keyMaterial = credentialKey(ctx.config);
    if (req.body?.provider === "gitlab") {
      await providers.testGitlab({ instanceUrl: req.body.instanceUrl }, req.body.token);
    }
    if (req.body?.provider === "git") {
      await providers.testGit(req.body);
    }
    const state = await loadRepos(ctx, req);
    const connection = normalizeConnection({
      ...req.body,
      createdByIdentityId: req.context.actor.id
    }, { keyMaterial });
    state.connections.push(connection);
    if (connection.provider === "git" && req.body?.url) {
      const inserted = upsertCatalogEntry(state.repositories, {
        url: req.body.url,
        connectionId: connection.id,
        provider: "git",
        defaultBranch: req.body.defaultBranch
      });
      state.repositories = inserted.repositories;
    }
    await saveRepos(ctx, req, state);
    res.status(201).json({ connection: publicConnection(connection) });
  }));

  app.post("/api/connections/:id/reauthorize", asyncH(async (req, res) => {
    requireWorkspaceManagement(req.context, "仅空间管理员可以管理代码连接");
    const state = await loadRepos(ctx, req);
    const found = currentConnection(state, req.params.id);
    if (found.provider === "gitlab") await ctx.gitProviders.testGitlab(found, req.body?.token);
    const connection = normalizeConnection({
      ...found,
      token: req.body?.token,
      password: req.body?.password,
      username: req.body?.username,
      status: "active",
      updatedAt: new Date().toISOString()
    }, { keyMaterial: credentialKey(ctx.config) });
    state.connections = state.connections.map((item) => item.id === found.id ? connection : item);
    state.repositories = state.repositories.map((item) => item.connectionId === found.id ? { ...item, availability: "available", updatedAt: connection.updatedAt } : item);
    await saveRepos(ctx, req, state);
    res.json({ connection: publicConnection(connection) });
  }));

  app.delete("/api/connections/:id", asyncH(async (req, res) => {
    requireWorkspaceManagement(req.context, "仅空间管理员可以管理代码连接");
    const repoState = await loadRepos(ctx, req);
    const projectState = ctx.persistence.projects ? await ctx.persistence.projects.load(req.context) : { projects: [], resources: [] };
    const next = disconnectConnection({ ...repoState, resources: projectState.resources }, req.params.id);
    await saveRepos(ctx, req, { connections: next.connections, repositories: next.repositories });
    if (ctx.persistence.projects) await ctx.persistence.projects.save(req.context, { projects: projectState.projects, resources: next.resources });
    res.json({ connection: publicConnection(next.connections.find((item) => item.id === req.params.id)) });
  }));

  app.get("/api/connections/:id/repositories", asyncH(async (req, res) => {
    const state = await loadRepos(ctx, req);
    const connection = currentConnection(state, req.params.id);
    if (connection.provider === "github_app") {
      const repositories = await ctx.gitProviders.listGithubRepositories(connection);
      return res.json({ repositories });
    }
    res.json({ repositories: state.repositories.filter((item) => item.connectionId === connection.id).map((item) => publicRepository(item)) });
  }));

  app.get("/api/repositories", asyncH(async (req, res) => {
    const state = await loadRepos(ctx, req);
    const projects = ctx.persistence.projects ? (await ctx.persistence.projects.load(req.context)).projects : [];
    const resources = ctx.persistence.projects ? (await ctx.persistence.projects.load(req.context)).resources : [];
    const withResources = projects.map((project) => ({ ...project, resources: resources.filter((resource) => resource.projectId === project.id) }));
    res.json({ repositories: state.repositories.map((item) => publicRepository(item, withResources)) });
  }));

  app.post("/api/repositories", asyncH(async (req, res) => {
    requireWorkspaceManagement(req.context, "仅空间管理员可以管理仓库目录");
    const state = await loadRepos(ctx, req);
    if (req.body?.connectionId) currentConnection(state, req.body.connectionId);
    const inserted = upsertCatalogEntry(state.repositories, req.body || {});
    state.repositories = inserted.repositories;
    await saveRepos(ctx, req, state);
    res.status(201).json({ repository: publicRepository(inserted.repository) });
  }));

  app.post("/api/projects/:id/repository-bindings", asyncH(async (req, res) => {
    if (!workspaceCapabilities(req.context).manageResources) {
      requireWorkspaceManagement(req.context, "仅空间管理员可以绑定项目资源");
    }
    const repoState = await loadRepos(ctx, req);
    const projectState = await ctx.persistence.projects.load(req.context);
    const project = projectState.projects.find((item) => item.id === req.params.id);
    if (!project) throw Object.assign(new Error("项目不存在"), { statusCode: 404, code: "PROJECT_NOT_FOUND" });
    const repository = repoState.repositories.find((item) => item.id === req.body?.repositoryId);
    if (!repository) throw Object.assign(new Error("仓库不存在"), { statusCode: 404, code: "REPOSITORY_NOT_FOUND" });
    const binding = bindRepositoryResource(project, repository, req.body?.ref);
    const replaced = replaceProjectBinding(projectState.resources, binding);
    await ctx.persistence.projects.save(req.context, { projects: projectState.projects, resources: replaced.resources });
    res.status(201).json({ resource: replaced.resource });
  }));
}
