import Fastify from "fastify";

export const server = Fastify({
  logger: true,
});

server.addHook("onRequest", async (request, reply) => {
  reply.header("Access-Control-Allow-Origin", "*");
  reply.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  reply.header("Access-Control-Allow-Headers", "Content-Type, Authorization, x-requested-with");
  if (request.method === "OPTIONS") {
    reply.status(204).send();
    return;
  }
});

