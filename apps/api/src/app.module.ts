import { Module } from "@nestjs/common";
import { HealthController } from "./health/health.controller";
import { SettingsController } from "./settings/settings.controller";
import { RulesController } from "./rules/rules.controller";
import { EventsController } from "./events/events.controller";
import { ToolsController } from "./tools/tools.controller";
import { OwnerController } from "./owner/owner.controller";
import { SchedulerService } from "./scheduler/scheduler.service";
import { ROUTE_CONTROLLERS } from "./routes/index";

/**
 * Um módulo só, de propósito: a Órbita é um processo de uma casa, não uma
 * plataforma. Quando um domínio (casa, câmeras) crescer a ponto de precisar
 * do próprio módulo, ele nasce; antes disso, fatiar é peso morto.
 *
 * Sem injeção por construtor: a lógica mora em singletons do @orbita/core
 * (settings, events, db). Isso dispensa `emitDecoratorMetadata` e deixa o
 * processo rodar direto de TypeScript com o tsx, sem etapa de build.
 */
@Module({
  controllers: [HealthController, SettingsController, RulesController, EventsController, ToolsController, OwnerController, ...ROUTE_CONTROLLERS],
  providers: [SchedulerService],
})
export class AppModule {}
