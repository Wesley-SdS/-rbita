import { Inject, Injectable, type OnApplicationBootstrap, type OnModuleDestroy } from "@nestjs/common";
import { HttpAdapterHost } from "@nestjs/core";
import type { Server } from "node:http";
import { ligarCanalDaExtensao } from "@orbita/core/navegador/canal";
import { atualizarDisponibilidade } from "@orbita/core/navegador/ordens";
import { fecharDedicado, ligarEspelhoDoDedicado } from "@orbita/core/navegador/dedicado";
import { log } from "@orbita/core/observability/logger";
// a tarefa delegada é um trabalho da fila: registra no boot, antes de o runner pegar algum
import "@orbita/core/navegador/trabalho";
import { anexarCanalDoNavegador } from "@orbita/core/navegador/servidor";

/**
 * O Chrome do dono no processo vivo (frente B): o canal da extensão no mesmo
 * servidor HTTP (porta 3010, só 127.0.0.1), o espelho do envelope, o estado
 * para a tela e o laço que lê a config do perfil dedicado (o `requires.available`
 * das tools é síncrono, então a config é lida aqui e guardada em memória).
 *
 * O `tsx watch` reinicia este processo a cada arquivo salvo: a extensão
 * reconecta sozinha (backoff no service worker), e o perfil dedicado fecha
 * junto (`OnModuleDestroy`), em vez de ficar um Chrome órfão.
 */
@Injectable()
export class NavegadorService implements OnApplicationBootstrap, OnModuleDestroy {
  private desligar: (() => void) | null = null;
  private relogio: NodeJS.Timeout | null = null;

  constructor(@Inject(HttpAdapterHost) private readonly adaptador: HttpAdapterHost) {}

  onApplicationBootstrap(): void {
    const server = this.adaptador.httpAdapter?.getHttpServer() as Server | undefined;
    if (!server) {
      log.warn("navegador.sem_servidor_http", {});
      return;
    }
    ligarCanalDaExtensao();
    // o perfil dedicado também recebe o envelope e o Parar (contrato das mãos, I-10)
    ligarEspelhoDoDedicado();
    this.desligar = anexarCanalDoNavegador(server);
    const ler = () => void atualizarDisponibilidade().catch(() => undefined);
    ler();
    this.relogio = setInterval(ler, 15_000);
    this.relogio.unref();
    log.info("navegador.canal_pronto", {});
  }

  async onModuleDestroy(): Promise<void> {
    if (this.relogio) clearInterval(this.relogio);
    this.desligar?.();
    await fecharDedicado("api desligando").catch(() => undefined);
  }
}
