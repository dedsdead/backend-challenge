---
name: nestjs-conventions
description: "Backend conventions for NestJS projects: modules, controllers, services, DTOs, migrations, security, decorators, interceptors, audit logging, DDD architecture, microservices, REST API best practices. Use when implementing or reviewing code in NestJS backends."
---

# NestJS Conventions

Follow these comprehensive conventions when working in NestJS applications, focusing on production-ready, maintainable, and scalable architecture.

## Core Architecture Principles

### Feature-Based Module Organization

Each feature should have its own module with clear boundaries:

```typescript
src/
├── modules/
│   ├── users/
│   │   ├── users.module.ts           # Module definition + imports
│   │   ├── users.controller.ts       # HTTP endpoints only
│   │   ├── users.service.ts          # Business logic + TypeORM repositories
│   │   ├── dto/
│   │   │   ├── create-user.dto.ts    # Input validation
│   │   │   ├── update-user.dto.ts    # Input validation
│   │   │   └── user-response.dto.ts  # Output transformation
│   │   ├── entities/
│   │   │   └── user.entity.ts        # TypeORM entity
│   │   └── users.spec.ts             # Unit tests
│   └── ...
├── common/                            # Shared cross-cutting concerns
│   ├── guards/
│   ├── interceptors/
│   ├── filters/
│   ├── decorators/
│   └── pipes/
└── app.module.ts                      # Root module with feature modules
```

**Rules:**
- Controllers: Handle HTTP, validation, and request/response transformation only
- Services: Business logic, repository calls, orchestrating complex operations
- DTOs: Input validation, output transformation, no business logic
- Entities: Database schema only, no business logic
- Controllers do NOT contain business logic

## REST API Construction

### Endpoint Structure and Conventions

```typescript
@Controller('users')
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly logger: Logger,
  ) {}

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  @Roles('admin', 'user')  // Custom role-based access
  async findOne(@Param('id') id: string, @Request() req) {
    this.logger.log(`Fetching user ${id} for ${req.user.email}`);
    return this.usersService.findOne(id);
  }

  @Post()
  @UseGuards(JwtAuthGuard)
  @Roles('admin')
  async create(@Body() createUserDto: CreateUserDto) {
    return this.usersService.create(createUserDto);
  }

  @Patch(':id/status')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async updateStatus(
    @Param('id') id: string,
    @Body() updateStatusDto: UpdateStatusDto
  ) {
    return this.usersService.updateStatus(id, updateStatusDto);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async remove(@Param('id') id: string) {
    await this.usersService.remove(id);
    return { message: 'User deleted successfully' };
  }
}
```

**API Design Guidelines:**
- Use nouns for resource paths: `/users`, `/orders`, `/invoices`
- Use verbs in HTTP methods: GET, POST, PATCH (partial update), DELETE
- Use 404 for not found, 400 for validation errors, 403 for unauthorized, 409 for conflicts
- Return 204 on DELETE for cleaner responses
- Pagination for list endpoints: `GET /users?page=1&limit=20`
- Filtering and sorting: query parameters with validation pipes

## DTOs and Validation

### Input Validation with Class Validator

```typescript
import { IsString, IsEmail, IsOptional, IsEnum, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';

export class CreateUserDto {
  @ApiProperty({
    example: 'john.doe@example.com',
    description: 'User email address',
    format: 'email'
  })
  @IsEmail({}, { message: 'Invalid email format' })
  @Transform(({ value }) => value.toLowerCase())
  email: string;

  @ApiProperty({
    example: 'John Doe',
    description: 'User full name',
    minLength: 2,
    maxLength: 100
  })
  @IsString()
  @MinLength(2, { message: 'Name must be at least 2 characters' })
  name: string;

  @ApiProperty({
    example: 'password123',
    description: 'User password',
    minLength: 8
  })
  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters' })
  password: string;

  @ApiProperty({
    example: 'ACTIVE',
    enum: UserStatus,
    required: false
  })
  @IsEnum(UserStatus, { message: 'Invalid status' })
  @IsOptional()
  status?: UserStatus;
}

export class UpdateUserDto {
  @ApiProperty({
    example: 'John Updated',
    description: 'Updated user name',
    required: false,
    minLength: 2,
    maxLength: 100
  })
  @IsString()
  @MinLength(2)
  @IsOptional()
  name?: string;

  @ApiProperty({
    example: 'john.doe@example.com',
    description: 'Updated email',
    required: false,
    format: 'email'
  })
  @IsEmail()
  @IsOptional()
  email?: string;
}
```

**DTO Best Practices:**
- Separate DTOs for input (create/update) vs output (response)
- Always validate with class-validator
- Use Swagger decorators for API documentation
- Transform data in DTOs when needed (e.g., lowercasing)
- Keep DTOs focused and single-responsibility
- Use inheritance and composition for related DTOs

## Services and Business Logic

### Service Layer Architecture

```typescript
import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from './entities/user.entity';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly logger: Logger,
  ) {
    this.logger.setContext('UsersService');
  }

  async create(createUserDto: CreateUserDto, userId: string): Promise<User> {
    this.logger.log(`Creating user by ${userId}`);

    const userExists = await this.userRepository.findOne({
      where: { email: createUserDto.email.toLowerCase() },
    });

    if (userExists) {
      throw new ConflictException('User with this email already exists');
    }

    const user = this.userRepository.create({
      ...createUserDto,
      email: createUserDto.email.toLowerCase(),
      createdBy: userId,
    });

    return await this.userRepository.save(user);
  }

  async findOne(id: string): Promise<User> {
    const user = await this.userRepository.findOne({ where: { id } });
    if (!user) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }
    return user;
  }

  async findAll(page: number, limit: number) {
    const skip = (page - 1) * limit;
    const [users, total] = await this.userRepository.findAndCount({
      skip,
      take: limit,
      order: { createdAt: 'DESC' },
    });

    return {
      data: users,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async update(id: string, updateUserDto: UpdateUserDto): Promise<User> {
    const user = await this.findOne(id);

    Object.assign(user, updateUserDto);
    return await this.userRepository.save(user);
  }

  async remove(id: string): Promise<void> {
    const user = await this.findOne(id);
    await this.userRepository.remove(user);
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.userRepository.findOne({
      where: { email: email.toLowerCase() },
    });
  }
}
```

**Service Best Practices:**
- One service per domain entity/module
- Services orchestrate between repositories and controllers
- Implement pagination, filtering, sorting in services
- Use repository pattern for data access
- Implement business rules in services, not controllers
- Use logger with context for debugging
- Transaction management for multi-step operations

## Repository Pattern

### Base Repository with Common Operations

```typescript
import { EntityRepository, Repository } from 'typeorm';
import { User } from '../entities/user.entity';

@EntityRepository(User)
export class UsersRepository extends Repository<User> {
  async findByEmail(email: string): Promise<User | null> {
    return this.findOne({ where: { email } });
  }

  async findActiveUsers(): Promise<User[]> {
    return this.find({ where: { status: UserStatus.ACTIVE } });
  }

  async searchUsers(query: string): Promise<User[]> {
    return this.createQueryBuilder('user')
      .where('user.name LIKE :query OR user.email LIKE :query', { query: `%${query}%` })
      .getMany();
  }

  async getTopUsers(limit: number): Promise<User[]> {
    return this.createQueryBuilder('user')
      .leftJoinAndSelect('user.posts', 'posts')
      .select(['user', 'COUNT(posts.id) as postCount'])
      .groupBy('user.id')
      .orderBy('postCount', 'DESC')
      .limit(limit)
      .getRawMany();
  }
}
```

## Decorators

### Custom Decorators for Common Patterns

```typescript
// decorators/audit.decorator.ts
export const AuditLog = (action: string) => {
  return (target: any, propertyKey: string, descriptor: PropertyDescriptor) => {
    const originalMethod = descriptor.value;

    descriptor.value = async function (...args: any[]) {
      const result = await originalMethod.apply(this, args);
      
      // Audit logging logic here
      console.log(`AUDIT: ${action} performed on ${propertyKey}`);
      
      return result;
    };
  };
};

// decorators/camel-case.decorator.ts
import { PipeTransform, Injectable } from '@nestjs/common';
import { transform } from 'lodash';

@Injectable()
export class CamelCasePipe implements PipeTransform {
  transform(value: any) {
    if (typeof value !== 'object') return value;
    return transform(value, (acc, val, key) => {
      acc[key] = typeof val === 'object' ? transform(val, (a, v, k) => a[k] = v) : val;
    }, {});
  }
}

// decorators/jwt-auth.decorator.ts
export const JwtAuth = () => SetMetadata('auth', true);

// decorators/roles.decorator.ts
export const Roles = (...roles: string[]) => SetMetadata('roles', roles);
```

### Built-in NestJS Decorators

```typescript
import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  UseGuards,
  ParseUUIDPipe,
  DefaultValuePipe,
  ParseIntPipe,
  ValidationPipe,
  UsePipes,
  Header,
  Query,
  HttpCode,
  HttpStatus,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import {
  // Class Validator
  IsString,
  IsEmail,
  IsEnum,
  MinLength,
  MaxLength,
  IsOptional,
  IsUUID,
  ArrayMinSize,
} from 'class-validator';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';

// Controller decorator with API documentation
@ApiTags('Users')
@ApiBearerAuth()
@Controller('users')
export class UsersController {
  // Validation pipes with error handling
  @UsePipes(
    new ValidationPipe({
      whitelist: true,           // Remove properties not in DTO
      forbidNonWhitelisted: true, // Throw error for extra properties
      transform: true,            // Transform DTO instances
      errorHttpStatusCode: HttpStatus.BAD_REQUEST,
    }),
  )
  
  // Query parameter with default value and pipe
  @Get()
  @ApiOperation({ summary: 'Get all users with pagination' })
  @ApiResponse({
    status: 200,
    description: 'Returns paginated list of users',
  })
  findAll(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
  ) {
    return this.usersService.findAll(page, limit);
  }

  // Parameter with UUID validation
  @Get(':id')
  @ApiOperation({ summary: 'Get a user by ID' })
  @ApiResponse({
    status: 200,
    description: 'Returns a single user',
  })
  @ApiResponse({
    status: 404,
    description: 'User not found',
  })
  async findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.usersService.findOne(id);
  }

  // Validation with custom message
  @Post()
  @ApiOperation({ summary: 'Create a new user' })
  @ApiResponse({
    status: 201,
    description: 'User created successfully',
  })
  @ApiResponse({
    status: 400,
    description: 'Validation failed',
  })
  async create(@Body() createUserDto: CreateUserDto) {
    return this.usersService.create(createUserDto);
  }

  // Response code
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    await this.usersService.remove(id);
  }
}
```

## Interceptors

### Custom Interceptors for Cross-Cutting Concerns

```typescript
// interceptors/transform.interceptor.ts
import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

export interface Response<T> {
  data: T;
  timestamp: string;
  status: string;
}

@Injectable()
export class TransformInterceptor<T> implements NestInterceptor<T, Response<T>> {
  intercept(context: ExecutionContext, next: CallHandler): Observable<Response<T>> {
    const now = new Date().toISOString();

    return next.handle().pipe(
      map(data => ({
        data,
        timestamp: now,
        status: 'success',
      })),
    );
  }
}

// interceptors/audit.interceptor.ts
import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const { method, url, user } = request;
    
    const startTime = Date.now();
    
    return next.handle().pipe(
      tap({
        next: () => {
          const duration = Date.now() - startTime;
          console.log(`AUDIT: ${method} ${url} - ${user?.email} - ${duration}ms`);
        },
      }),
    );
  }
}

// interceptors/exception.interceptor.ts
import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Response } from 'express';

@Catch(HttpException)
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: HttpException, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const status = exception.getStatus();
    const exceptionResponse = exception.getResponse();

    const errorResponse = {
      statusCode: status,
      timestamp: new Date().toISOString(),
      message: exception.message,
      error: exceptionResponse,
    };

    response.status(status).json(errorResponse);
  }
}

// interceptors/logging.interceptor.ts
import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const { method, url, body } = request;
    
    console.log(`[${method}] ${url}`, body);
    
    return next.handle().pipe(
      tap({
        next: () => {
          console.log(`[${method}] ${url} - Completed`);
        },
        error: (error) => {
          console.log(`[${method}] ${url} - Error:`, error.message);
        },
      }),
    );
  }
}

// interceptors/timeout.interceptor.ts
import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Observable } from 'rxjs';
import { timeout, catchError } from 'rxjs/operators';
import { TimeoutError } from 'rxjs';

@Injectable()
export class TimeoutInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    return next.handle().pipe(
      timeout(5000), // 5 second timeout
      catchError((err) => {
        if (err instanceof TimeoutError) {
          throw new BadRequestException('Request timeout');
        }
        throw err;
      }),
    );
  }
}
```

### Built-in Interceptors

```typescript
import {
  UseInterceptors,
  ClassSerializerInterceptor,
  UseGuards,
  UsePipes,
  SetMetadata,
} from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';

// Apply to controller or class
@UseInterceptors(ClassSerializerInterceptor)
export class UsersController {
  // ClassSerializerInterceptor automatically serializes entities to DTOs
  @Get()
  findAll() {
    return this.usersService.findAll();
  }
}

// Global pipe for validation
app.useGlobalPipes(
  new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  }),
);

// Global error filter registration in main.ts
app.useGlobalFilters(new HttpExceptionFilter());
```

## Guards and Security

### Auth Guards

```typescript
// guards/jwt-auth.guard.ts
import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private jwtService: JwtService,
    private reflector: Reflector,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.get<boolean>('isPublic', context.getHandler());
    
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest();
    const token = this.extractTokenFromHeader(request);

    if (!token) {
      throw new UnauthorizedException('No token provided');
    }

    try {
      const payload = this.jwtService.verify(token);
      request.user = payload;
    } catch (error) {
      throw new UnauthorizedException('Invalid token');
    }

    return true;
  }

  private extractTokenFromHeader(request: any): string | undefined {
    const [type, token] = request.headers.authorization?.split(' ') ?? [];
    return type === 'Bearer' ? token : undefined;
  }
}

// guards/roles.guard.ts
import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.get<string[]>('roles', context.getHandler());
    
    if (!requiredRoles) return true;

    const { user } = context.switchToHttp().getRequest();
    
    return requiredRoles.some((role) => user.roles?.includes(role));
  }
}

// guards/rate-limit.guard.ts
import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';

interface RateLimitData {
  count: number;
  resetTime: number;
}

const rateLimitStore = new Map<string, RateLimitData>();

@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly limit = 10; // Requests per window
  private readonly windowMs = 60000; // 1 minute

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const { ip, url } = request;
    const key = `${ip}:${url}`;

    const now = Date.now();
    let data = rateLimitStore.get(key);

    if (!data || now > data.resetTime) {
      data = {
        count: 1,
        resetTime: now + this.windowMs,
      };
      rateLimitStore.set(key, data);
    } else {
      data.count++;
    }

    if (data.count > this.limit) {
      throw new BadRequestException('Too many requests');
    }

    return true;
  }
}

// guards/throttler.guard.ts
import { Injectable, CanActivate } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

@Injectable()
export class ApiThrottlerGuard extends ThrottlerGuard {
  constructor() {
    super([
      {
        limit: 5,
        ttl: 60000, // 1 minute
      },
    ]);
  }
}
```

### Security Best Practices

```typescript
// modules/security/security.module.ts
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtStrategy } from './strategies/jwt.strategy';
import { EncryptionService } from './encryption.service';

@Module({
  imports: [
    PassportModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_SECRET'),
        signOptions: {
          expiresIn: configService.get<string>('JWT_EXPIRATION') || '1d',
        },
      }),
      inject: [ConfigService],
    }),
  ],
  providers: [JwtStrategy, EncryptionService],
  exports: [JwtModule, EncryptionService],
})
export class SecurityModule {}

// modules/security/encryption.service.ts
import { Injectable } from '@nestjs/common';
import * as bcrypt from 'bcrypt';

@Injectable()
export class EncryptionService {
  private readonly saltRounds = 10;

  async hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, this.saltRounds);
  }

  async comparePassword(password: string, hash: string): Promise<boolean> {
    return bcrypt.compare(password, hash);
  }

  encrypt(data: string): string {
    // For sensitive data in cache or storage
    return require('crypto').createHmac('sha256', process.env.ENCRYPTION_KEY)
      .update(data)
      .digest('hex');
  }
}
```

## DDD Architecture

### Domain Entities with Value Objects

```typescript
// domains/users/entities/user.entity.ts
import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn } from 'typeorm';
import { UserStatus } from '../enums/user-status.enum';
import { Address } from '../value-objects/address.value-object';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column({ unique: true })
  email: string;

  @Column()
  password: string;

  @Column({ type: 'enum', enum: UserStatus, default: UserStatus.ACTIVE })
  status: UserStatus;

  @Column({ nullable: true })
  @CreateDateColumn()
  createdAt: Date;

  @Column({ nullable: true })
  @UpdateDateColumn()
  updatedAt: Date;

  // Embeddable value object
  @Embedded(() => Address)
  address: Address;

  // Business method
  isAccountActive(): boolean {
    return this.status === UserStatus.ACTIVE;
  }

  canEdit(user: User): boolean {
    return this.id === user.id || user.isAdmin;
  }
}

// domains/users/value-objects/address.value-object.ts
import { Column, Entity, PrimaryColumn, Index } from 'typeorm';

@Embeddable()
export class Address {
  @PrimaryColumn()
  street: string;

  @PrimaryColumn()
  city: string;

  @PrimaryColumn()
  country: string;

  @Column({ nullable: true })
  postalCode: string;
}

// domains/users/enums/user-status.enum.ts
export enum UserStatus {
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
  SUSPENDED = 'SUSPENDED',
}
```

### Aggregate Roots and Repositories

```typescript
// domains/users/repositories/user.repository.ts
import { EntityRepository, Repository } from 'typeorm';
import { User } from '../entities/user.entity';

@EntityRepository(User)
export class UserRepository extends Repository<User> {
  async findByEmail(email: string): Promise<User | null> {
    return this.createQueryBuilder('user')
      .where('user.email = :email', { email: email.toLowerCase() })
      .getOne();
  }

  async findActiveUsers(): Promise<User[]> {
    return this.createQueryBuilder('user')
      .where('user.status = :status', { status: UserStatus.ACTIVE })
      .getMany();
  }
}

// domains/users/services/user.service.ts
import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../entities/user.entity';
import { CreateUserDto } from '../dto/create-user.dto';

@Injectable()
export class UserService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {}

  async registerUser(createUserDto: CreateUserDto): Promise<User> {
    const user = this.userRepository.create(createUserDto);
    
    // Business logic before persistence
    if (user.email) {
      user.email = user.email.toLowerCase();
    }
    
    return await this.userRepository.save(user);
  }
}
```

## Microservices

### Message Brokers and Communication

```typescript
// microservices/users/users.controller.ts
import { Controller, EventPattern, Payload } from '@nestjs/microservices';

@Controller()
export class UsersMicroserviceController {
  @EventPattern('user.created')
  async handleUserCreated(@Payload() data: any) {
    console.log('User created:', data);
    // Process the event
  }

  @EventPattern('user.updated')
  async handleUserUpdated(@Payload() data: any) {
    console.log('User updated:', data);
  }

  @MessagePattern({ cmd: 'get_user' })
  async getUser(@Payload() id: string) {
    return this.usersService.findOne(id);
  }

  @MessagePattern({ cmd: 'list_users' })
  async listUsers() {
    return this.usersService.findAll();
  }
}

// microservices/users/users.module.ts
import { Module } from '@nestjs/common';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { ConfigModule, ConfigService } from '@nestjs/config';

@Module({
  imports: [
    ClientsModule.registerAsync([
      {
        name: 'USERS_SERVICE',
        imports: [ConfigModule],
        useFactory: async (configService: ConfigService) => ({
          transport: Transport.TCP,
          options: {
            host: configService.get<string>('USERS_SERVICE_HOST'),
            port: configService.get<number>('USERS_SERVICE_PORT'),
          },
        }),
        inject: [ConfigService],
      },
    ]),
  ],
  exports: [ClientsModule],
})
export class UsersMicroserviceModule {}
```

### Event-Driven Architecture

```typescript
// microservices/events/user-events.service.ts
import { Injectable } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { EventPattern, Payload } from '@nestjs/microservices';

@Injectable()
export class UserEventsService {
  constructor(
    @Inject('EVENT_BUS') private readonly eventBus: ClientProxy,
  ) {}

  async emitUserCreated(userId: string, email: string) {
    this.eventBus.emit('user.created', {
      userId,
      email,
      timestamp: new Date().toISOString(),
    });
  }

  async emitUserUpdated(userId: string, changes: any) {
    this.eventBus.emit('user.updated', {
      userId,
      changes,
      timestamp: new Date().toISOString(),
    });
  }

  async emitUserDeleted(userId: string) {
    this.eventBus.emit('user.deleted', {
      userId,
      timestamp: new Date().toISOString(),
    });
  }
}

// microservices/events/user-events.controller.ts
import { Controller, Post, Body } from '@nestjs/common';
import { UserEventsService } from './user-events.service';

@Controller('events')
export class UserEventsController {
  constructor(private readonly userEventsService: UserEventsService) {}

  @Post('user-created')
  async handleUserCreated(@Body() event: any) {
    this.userEventsService.emitUserCreated(event.userId, event.email);
  }
}
```

## Audit Logging

### Comprehensive Audit Trail

```typescript
// modules/audit/audit.service.ts
import { Injectable, InjectableException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditLog } from './entities/audit-log.entity';

export interface AuditAction {
  action: string;
  entityType: string;
  entityId: string;
  userId?: string;
  changes?: any;
  ipAddress?: string;
  userAgent?: string;
}

@Injectable()
export class AuditService {
  constructor(
    @InjectRepository(AuditLog)
    private readonly auditLogRepository: Repository<AuditLog>,
  ) {}

  async log(action: AuditAction): Promise<void> {
    const auditLog = this.auditLogRepository.create({
      action: action.action,
      entityType: action.entityType,
      entityId: action.entityId,
      userId: action.userId,
      changes: JSON.stringify(action.changes),
      ipAddress: action.ipAddress,
      userAgent: action.userAgent,
    });

    await this.auditLogRepository.save(auditLog);
  }

  async findByEntity(entityType: string, entityId: string): Promise<AuditLog[]> {
    return this.auditLogRepository.find({
      where: { entityType, entityId },
      order: { createdAt: 'DESC' },
    });
  }

  async findByUser(userId: string): Promise<AuditLog[]> {
    return this.auditLogRepository.find({
      where: { userId },
      order: { createdAt: 'DESC' },
    });
  }
}

// modules/audit/audit.interceptor.ts
import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Request } from 'express';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { AuditService, AuditAction } from './audit.service';

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(private readonly auditService: AuditService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest<Request>();
    const { method, url, body, user, ip, headers } = request;
    const now = Date.now();

    return next.handle().pipe(
      tap({
        next: () => {
          const duration = Date.now() - now;
          const action: AuditAction = {
            action: `${method} ${url}`,
            entityType: 'unknown',
            entityId: 'unknown',
            userId: user?.id,
            changes: body,
            ipAddress: ip,
            userAgent: headers['user-agent'],
          };

          this.auditService.log(action);
        },
      }),
    );
  }
}
```

### Audit Log Entity

```typescript
// modules/audit/entities/audit-log.entity.ts
import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, Index } from 'typeorm';

@Entity('audit_logs')
@Index(['entityType', 'entityId'])
@Index(['userId'])
@Index(['createdAt'])
export class AuditLog {
  @PrimaryGeneratedColumn()
  id: string;

  @Column()
  action: string;

  @Column()
  entityType: string;

  @Column()
  entityId: string;

  @Column({ nullable: true })
  userId: string;

  @Column({ type: 'json', nullable: true })
  changes: any;

  @Column({ nullable: true })
  ipAddress: string;

  @Column({ nullable: true })
  userAgent: string;

  @CreateDateColumn()
  createdAt: Date;
}
```

## Error Handling

### Custom Exception Classes

```typescript
// modules/exceptions/http-exceptions.filter.ts
import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpExceptionOptions,
} from '@nestjs/common';
import { Response } from 'express';

interface ErrorResponse {
  statusCode: number;
  timestamp: string;
  message: string | string[];
  errors?: any;
}

@Catch(HttpException)
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: HttpException, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const status = exception.getStatus();
    const exceptionResponse = exception.getResponse();

    const errorResponse: ErrorResponse = {
      statusCode: status,
      timestamp: new Date().toISOString(),
      message: exception.message,
    };

    if (exception instanceof BadRequestException) {
      errorResponse.errors = exception.getResponse();
    }

    response.status(status).json(errorResponse);
  }
}

// exceptions/bad-request.exception.ts
import { HttpException, HttpStatus } from '@nestjs/common';

export class BadRequestException extends HttpException {
  constructor(message: string | string[] = 'Bad request') {
    super(
      {
        message,
        statusCode: HttpStatus.BAD_REQUEST,
        error: 'Bad Request',
      },
      HttpStatus.BAD_REQUEST,
    );
  }
}

// exceptions/not-found.exception.ts
import { HttpException, HttpStatus } from '@nestjs/common';

export class NotFoundException extends HttpException {
  constructor(resource: string, id?: string) {
    const message = id 
      ? `${resource} with ID ${id} not found`
      : `${resource} not found`;
    
    super({
      message,
      statusCode: HttpStatus.NOT_FOUND,
      error: 'Not Found',
    }, HttpStatus.NOT_FOUND);
  }
}
```

### Global Exception Handling

```typescript
// main.ts
import { NestFactory } from '@nestjs/core';
import { ValidationPipe, } from '@nestjs/common';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Global validation pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // Global exception filter
  app.useGlobalFilters(new HttpExceptionFilter());

  // Global CORS
  app.enableCors({
    origin: process.env.CORS_ORIGIN,
    credentials: true,
  });

  await app.listen(process.env.PORT);
}

bootstrap();
```

## Testing

### Unit Tests with Jest

```typescript
// users/users.service.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { UsersService } from './users.service';
import { User } from './entities/user.entity';
import { ConflictException } from '@nestjs/common';

describe('UsersService', () => {
  let service: UsersService;
  let repository: Repository<User>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        {
          provide: getRepositoryToken(User),
          useClass: MockRepository,
        },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
    repository = module.get<Repository<User>>(getRepositoryToken(User));
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    it('should create a user successfully', async () => {
      const createUserDto = {
        email: 'test@example.com',
        name: 'Test User',
        password: 'password123',
      };

      const savedUser = { ...createUserDto, id: '1' as string };
      
      repository.findOne = jest.fn().mockResolvedValue(null);
      repository.create = jest.fn().mockReturnValue(savedUser);
      repository.save = jest.fn().mockResolvedValue(savedUser);

      const result = await service.create(createUserDto, 'user-id');

      expect(repository.create).toHaveBeenCalledWith({
        ...createUserDto,
        email: createUserDto.email.toLowerCase(),
      });
      expect(repository.save).toHaveBeenCalled();
    });

    it('should throw ConflictException when email already exists', async () => {
      const createUserDto = {
        email: 'existing@example.com',
        name: 'Test User',
        password: 'password123',
      };

      repository.findOne = jest.fn().mockResolvedValue({
        id: '1' as string,
        email: createUserDto.email,
      });

      await expect(service.create(createUserDto, 'user-id')).rejects.toThrow(ConflictException);
    });
  });
});
```

## Performance Optimizations

### Caching Strategy

```typescript
// modules/cache/cache.service.ts
import { Injectable } from '@nestjs/common';
import { Cache } from 'cache-manager';

@Injectable()
export class CacheService {
  constructor(private readonly cache: Cache) {}

  async get<T>(key: string): Promise<T | null> {
    return this.cache.get<T>(key);
  }

  async set<T>(key: string, value: T, ttl?: number): Promise<void> {
    await this.cache.set(key, value, ttl);
  }

  async del(key: string): Promise<void> {
    await this.cache.del(key);
  }

  async reset(): Promise<void> {
    await this.cache.reset();
  }
}

// interceptors/cache.interceptor.ts
import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

@Injectable()
export class CacheInterceptor implements NestInterceptor {
  constructor(private readonly cacheService: CacheService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const { method, url, params } = request;
    const cacheKey = `${method}:${url}:${JSON.stringify(params)}`;

    return next.handle().pipe(
      map(async (data) => {
        await this.cacheService.set(cacheKey, data, 3600); // Cache for 1 hour
        return data;
      }),
    );
  }
}
```

### Pagination and Optimization

```typescript
// utils/pagination.helper.ts
export class PaginationHelper {
  static createPaginatedResponse(
    data: any[],
    total: number,
    page: number,
    limit: number,
  ) {
    const totalPages = Math.ceil(total / limit);
    const hasNext = page < totalPages;
    const hasPrevious = page > 1;

    return {
      data,
      meta: {
        total,
        page,
        limit,
        totalPages,
        hasNext,
        hasPrevious,
      },
    };
  }

  static getSkipLimit(page: number, limit: number) {
    return {
      skip: (page - 1) * limit,
      take: limit,
    };
  }
}
```

## Documentation with Swagger

```typescript
// main.ts
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  const config = new DocumentBuilder()
    .setTitle('API Documentation')
    .setDescription('My API endpoints')
    .setVersion('1.0')
    .addBearerAuth()
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);

  await app.listen(3000);
}
```

## Final Recommendations

1. **Always validate input**: Use class-validator on all DTOs
2. **Use decorators wisely**: Keep them focused and well-documented
3. **Structure modules**: Follow feature-based architecture
4. **Handle errors gracefully**: Implement custom exceptions and global filters
5. **Security first**: Use guards, rate limiting, and proper authentication
6. **Document everything**: Use Swagger/OpenAPI
7. **Write tests**: Unit tests for services, integration tests for endpoints
8. **Log appropriately**: Use Winston for structured logging
9. **Monitor performance**: Implement caching and optimize queries
10. **Keep code clean**: Follow SOLID principles and DDD patterns

See official NestJS documentation at https://docs.nestjs.com/ for detailed guidance on all features and best practices.
