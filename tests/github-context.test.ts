import { describe, expect, it, vi } from "vitest";
import { fetchTarball, listOwnedRepos } from "@/lib/github";
import { withGitHub } from "@/lib/github-context";

describe("GitHub context", () => {
  it("lists the installation's repos inside an installation context, and the token user's outside it", async () => {
    const paginate = vi.fn().mockResolvedValue([{ id: 1 }]);
    const rest = { apps: { listReposAccessibleToInstallation: "installation-endpoint" }, repos: { listForAuthenticatedUser: "user-endpoint" } };
    const octokit = { paginate, rest } as never;
    await withGitHub({ octokit, token: async () => "t", installationId: 5 }, () => listOwnedRepos());
    expect(paginate).toHaveBeenLastCalledWith("installation-endpoint", { per_page: 100 });
    await withGitHub({ octokit, token: async () => "t" }, () => listOwnedRepos());
    expect(paginate).toHaveBeenLastCalledWith("user-endpoint", { affiliation: "owner", per_page: 100 });
  });

  it("downloads tarballs with the context's token", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("x"));
    await withGitHub({ octokit: {} as never, token: async () => "ghs_installation" }, () => fetchTarball("o", "r", "abc"));
    expect((fetchMock.mock.calls[0][1]?.headers as Record<string, string>).authorization).toBe("Bearer ghs_installation");
    fetchMock.mockRestore();
  });
});
