import { DocumentBuilder } from '@nestjs/swagger';

export function buildSwaggerConfig() {
  return new DocumentBuilder()
    .setTitle('Internal Operations Service Hub API')
    .setDescription(
      'Submit, route, track, and resolve employee requests. ' +
        'Authenticate via POST /auth/login, then use the Authorize button to send the returned JWT as ' +
        '`Authorization: Bearer <token>`. Demo logins: admin@acme.com, ' +
        'alice@acme.com, bob@acme.com (password Password123!).',
    )
    .setVersion('1.0.0')
    .addBearerAuth()
    .addSecurityRequirements('bearer')
    .build();
}
