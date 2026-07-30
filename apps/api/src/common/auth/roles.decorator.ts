import { SetMetadata } from '@nestjs/common';

export const ROLES_KEY = 'roles';

/** Roles permitidos para un handler — leído por `RolesGuard`. Sin este decorador, `RolesGuard` deja pasar a cualquier usuario autenticado. */
export const Roles = (...roles: string[]): MethodDecorator & ClassDecorator => SetMetadata(ROLES_KEY, roles);
