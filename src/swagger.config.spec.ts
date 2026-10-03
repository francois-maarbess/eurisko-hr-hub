import { AuthController } from './auth/auth.controller';
import { CreateRequestDto } from './dto/create-request.dto';
import { HealthController } from './health.controller';
import { buildSwaggerConfig } from './swagger.config';

describe('Swagger authentication and request contract', () => {
  it('applies the bearer scheme globally so protected operations send the JWT', () => {
    const config = buildSwaggerConfig();

    expect(config.security).toEqual([{ bearer: [] }]);
    expect(config.components?.securitySchemes?.bearer).toMatchObject({
      type: 'http',
      scheme: 'bearer',
      bearerFormat: 'JWT',
    });
  });

  it('keeps login, refresh, MFA challenge, and health public in the API explorer', () => {
    const publicOperations = [
      [AuthController.prototype, 'login'],
      [AuthController.prototype, 'refresh'],
      [AuthController.prototype, 'mfaChallenge'],
      [HealthController.prototype, 'check'],
    ] as const;

    for (const [controller, method] of publicOperations) {
      const operation = Reflect.getMetadata('swagger/apiOperation', controller[method]);
      expect(operation.security).toEqual([]);
    }
  });

  it('exposes the required request fields and bounds in the Swagger schema', () => {
    const title = Reflect.getMetadata('swagger/apiModelProperties', CreateRequestDto.prototype, 'title');
    const description = Reflect.getMetadata('swagger/apiModelProperties', CreateRequestDto.prototype, 'description');
    const priority = Reflect.getMetadata('swagger/apiModelProperties', CreateRequestDto.prototype, 'priority');

    expect(title).toMatchObject({ minLength: 3, maxLength: 200 });
    expect(title.required).not.toBe(false);
    expect(description).toMatchObject({ minLength: 10, maxLength: 2000 });
    expect(description.required).not.toBe(false);
    expect(priority).toMatchObject({ enum: ['LOW', 'STANDARD', 'URGENT'], default: 'STANDARD' });
  });
});
