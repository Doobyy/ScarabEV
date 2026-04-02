import { loadConfig, type Env, type RuntimeConfig } from "./config/env";
import { captureError, logInfo } from "./observability/logger";

interface RequestContext {
  requestId: string;
  startedAt: number;
}

function createContext(): RequestContext {
  return {
    requestId: crypto.randomUUID(),
    startedAt: Date.now()
  };
}

function jsonResponse(payload: Record<string, unknown>, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");

  return new Response(JSON.stringify(payload), {
    ...init,
    headers
  });
}

async function routeRequest(request: Request, config: RuntimeConfig, ctx: RequestContext): Promise<Response> {
  const url = new URL(request.url);

  if (request.method === "GET" && url.pathname === "/healthz") {
    return jsonResponse(
      {
        ok: true,
        service: config.appName,
        environment: config.appEnv,
        requestId: ctx.requestId
      },
      {
        status: 200,
        headers: {
          "x-request-id": ctx.requestId
        }
      }
    );
  }

  return jsonResponse(
    {
      ok: false,
      error: "not_found",
      requestId: ctx.requestId
    },
    {
      status: 404,
      headers: {
        "x-request-id": ctx.requestId
      }
    }
  );
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const config = loadConfig(env);
    const reqCtx = createContext();

    logInfo(config, "request.start", {
      requestId: reqCtx.requestId,
      method: request.method,
      path: new URL(request.url).pathname
    });

    try {
      const response = await routeRequest(request, config, reqCtx);
      logInfo(config, "request.finish", {
        requestId: reqCtx.requestId,
        status: response.status,
        durationMs: Date.now() - reqCtx.startedAt
      });
      return response;
    } catch (error) {
      captureError(config, error, {
        requestId: reqCtx.requestId,
        durationMs: Date.now() - reqCtx.startedAt
      });

      return jsonResponse(
        {
          ok: false,
          error: "internal_error",
          requestId: reqCtx.requestId
        },
        {
          status: 500,
          headers: {
            "x-request-id": reqCtx.requestId
          }
        }
      );
    }
  }
};
