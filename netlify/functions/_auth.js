// netlify/functions/_auth.js
// Helper compartido: extrae el contexto del usuario que Netlify Identity
// inyecta automáticamente en `context.clientContext.user` cuando la request
// trae un Authorization: Bearer <jwt> válido.
//
// IMPORTANTE: Netlify valida la firma del JWT en su edge antes de invocar
// la función. Si el token es inválido o falta, `context.clientContext.user`
// será null. No hace falta validar la firma manualmente.

function requireAuth(context) {
  const user = context?.clientContext?.user;
  if (!user) {
    return {
      ok: false,
      response: {
        statusCode: 401,
        headers: {
          'Content-Type': 'application/json',
          'WWW-Authenticate': 'Bearer'
        },
        body: JSON.stringify({ error: 'Unauthorized: se requiere iniciar sesión' })
      }
    };
  }
  return { ok: true, user };
}

module.exports = { requireAuth };
