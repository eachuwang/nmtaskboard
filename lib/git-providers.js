import { canonicalRepositoryIdentity } from "./repositories.js";

function providerError(code, message, statusCode = 400) {
  return Object.assign(new Error(message), { statusCode, code });
}

export function createGitProviders(options = {}) {
  return {
    async listGithubRepositories(connection) {
      if (typeof options.listGithubRepositories === "function") return options.listGithubRepositories(connection);
      return [];
    },
    async testGitlab(connection, token) {
      if (typeof options.testGitlab === "function") return options.testGitlab(connection, token);
      const instanceUrl = connection.instanceUrl || "https://gitlab.com";
      try {
        const response = await fetch(`${instanceUrl.replace(/\/+$/, "")}/api/v4/user`, {
          headers: token ? { "PRIVATE-TOKEN": token } : {}
        });
        if (response.status === 401 || response.status === 403) {
          throw providerError("GITLAB_AUTH_FAILED", "GitLab 凭据无效或权限不足", 400);
        }
        if (!response.ok) throw providerError("GITLAB_UNAVAILABLE", `GitLab 连接测试失败（HTTP ${response.status}）`, 400);
        return { ok: true };
      } catch (error) {
        if (error.code) throw error;
        throw providerError("GITLAB_UNAVAILABLE", error.message || "GitLab 连接测试失败", 400);
      }
    },
    async testGit(connection) {
      if (typeof options.testGit === "function") return options.testGit(connection);
      canonicalRepositoryIdentity(connection.url || connection.instanceUrl);
      return { ok: true };
    }
  };
}
