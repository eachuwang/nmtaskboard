import { normalizeProject, normalizeResource, withProjectDerived } from "../projects.js";
import { requireWorkspaceManagement, workspaceCapabilities } from "../permissions.js";

const asyncH = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function currentProject(state, id) {
  const project = state.projects.find((item) => item.id === id);
  if (!project) throw Object.assign(new Error("项目不存在"), { statusCode: 404, code: "PROJECT_NOT_FOUND" });
  return project;
}

export function register(app, ctx) {
  const load = async (req) => {
    if (!ctx.persistence.projects) return { projects: [], resources: [] };
    return ctx.persistence.projects.load(req.context);
  };
  const save = (req, state) => ctx.persistence.projects.save(req.context, state);

  app.get("/api/projects", asyncH(async (req, res) => {
    const state = await load(req);
    const tasks = await ctx.persistence.tasks.load(req.context);
    res.json({ projects: state.projects.map((project) => withProjectDerived(project, tasks, state.resources)) });
  }));

  app.get("/api/projects/:id", asyncH(async (req, res) => {
    const state = await load(req);
    const project = currentProject(state, req.params.id);
    const tasks = await ctx.persistence.tasks.load(req.context);
    res.json({ project: withProjectDerived(project, tasks, state.resources), tasks: tasks.filter((task) => task.projectId === project.id) });
  }));

  app.post("/api/projects", asyncH(async (req, res) => {
    if (!workspaceCapabilities(req.context).manageProjects) return res.status(403).json({ error: "工作区成员才能创建项目" });
    const state = await load(req);
    const project = normalizeProject({ ...req.body, createdByIdentityId: req.context.actor.id });
    state.projects.push(project);
    await save(req, state);
    res.status(201).json({ project: withProjectDerived(project, [], state.resources) });
  }));

  app.put("/api/projects/:id", asyncH(async (req, res) => {
    if (!workspaceCapabilities(req.context).manageProjects) return res.status(403).json({ error: "工作区成员才能编辑项目" });
    const state = await load(req);
    const project = currentProject(state, req.params.id);
    const updated = normalizeProject({ ...project, ...req.body, id: project.id, createdAt: project.createdAt, createdByIdentityId: project.createdByIdentityId });
    state.projects = state.projects.map((item) => item.id === project.id ? updated : item);
    await save(req, state);
    const tasks = await ctx.persistence.tasks.load(req.context);
    res.json({ project: withProjectDerived(updated, tasks, state.resources) });
  }));

  app.delete("/api/projects/:id", asyncH(async (req, res) => {
    requireWorkspaceManagement(req.context, "仅空间管理员可以删除项目");
    const state = await load(req);
    const project = currentProject(state, req.params.id);
    const tasks = await ctx.persistence.tasks.load(req.context);
    const detachedTasks = tasks.filter((task) => task.projectId === project.id).length;
    for (const task of tasks) if (task.projectId === project.id) {
      task.projectId = null;
      task.updatedAt = new Date().toISOString();
    }
    await ctx.persistence.tasks.save(req.context, tasks);
    state.projects = state.projects.filter((item) => item.id !== project.id);
    state.resources = state.resources.filter((resource) => resource.projectId !== project.id);
    await save(req, state);
    res.json({ removed: 1, detachedTasks });
  }));

  app.post("/api/projects/:id/resources", asyncH(async (req, res) => {
    requireWorkspaceManagement(req.context, "仅空间管理员可以管理项目资源");
    const state = await load(req);
    currentProject(state, req.params.id);
    const resource = normalizeResource({ ...req.body, projectId: req.params.id, createdByIdentityId: req.context.actor.id });
    state.resources.push(resource);
    await save(req, state);
    res.status(201).json({ resource });
  }));

  app.put("/api/projects/:id/resources/:resourceId", asyncH(async (req, res) => {
    requireWorkspaceManagement(req.context, "仅空间管理员可以管理项目资源");
    const state = await load(req);
    currentProject(state, req.params.id);
    const found = state.resources.find((item) => item.id === req.params.resourceId && item.projectId === req.params.id);
    if (!found) throw Object.assign(new Error("项目资源不存在"), { statusCode: 404, code: "PROJECT_RESOURCE_NOT_FOUND" });
    const resource = normalizeResource({ ...found, ...req.body, id: found.id, projectId: found.projectId, createdAt: found.createdAt, createdByIdentityId: found.createdByIdentityId });
    state.resources = state.resources.map((item) => item.id === found.id ? resource : item);
    await save(req, state);
    res.json({ resource });
  }));

  app.delete("/api/projects/:id/resources/:resourceId", asyncH(async (req, res) => {
    requireWorkspaceManagement(req.context, "仅空间管理员可以管理项目资源");
    const state = await load(req);
    currentProject(state, req.params.id);
    const before = state.resources.length;
    state.resources = state.resources.filter((item) => !(item.id === req.params.resourceId && item.projectId === req.params.id));
    if (before === state.resources.length) throw Object.assign(new Error("项目资源不存在"), { statusCode: 404, code: "PROJECT_RESOURCE_NOT_FOUND" });
    await save(req, state);
    res.json({ removed: 1 });
  }));
}
