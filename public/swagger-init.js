window.addEventListener('DOMContentLoaded', () => {
  window.ui = SwaggerUIBundle({
    url: '/openapi.json',
    dom_id: '#swagger-ui',
    deepLinking: true,
    displayRequestDuration: true,
    docExpansion: 'list',
    supportedSubmitMethods: ['get'],
    withCredentials: true,
    persistAuthorization: false,
    // El contrato personal se valida y consulta dentro de esta aplicación.
    validatorUrl: null,
  });
});
