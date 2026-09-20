/* GERADO por `scripts/portar-presenca.py` a partir de
   `prototypes/orbita-presenca/orb.js`. NÃO EDITE À MÃO: rode o script.

   O texto de cada estado do núcleo (o que a tela diz enquanto ele pensa, fala
   ou espera uma decisão) é parte do desenho, não da implementação. Vem daqui
   em vez de escrito nas telas porque, escrito à mão, ele diverge do protótipo
   em silêncio na primeira vez que a proposta muda uma frase. */

export interface FalaDoEstado {
  /** nome curto, para etiquetas */
  label: string;
  /** linha de status ao lado do ponto luminoso */
  status: string;
  /** título grande sob o núcleo */
  title: string;
  /** frase de apoio */
  description: string;
}

export const ESTADOS_NUCLEO = {
  idle: { label: "Presença", status: "Núcleo ativo · aguardando seu comando", title: "O que vamos fazer hoje?", description: "Uma ideia, um plano ou só uma conversa. Estou com você." },
  listening: { label: "Escutando", status: "Canal de escuta aberto", title: "Pode falar. Estou aqui.", description: "Seu microfone está aberto. É só falar." },
  thinking: { label: "Pensando", status: "Processando · conectando possibilidades", title: "Deixe eu ligar os pontos.", description: "Buscando sentido entre o que você disse e o que importa." },
  speaking: { label: "Falando", status: "Transmitindo resposta", title: "Encontrei um bom caminho.", description: "A estrutura inteira acompanha o ritmo da fala." },
  searching: { label: "Pesquisando", status: "Varredura de contexto em andamento", title: "Um olhar um pouco mais longe.", description: "Percorrendo suas fontes e o que está conectado." },
  connecting: { label: "Conectando", status: "Estabelecendo conexões", title: "Tudo começa a se conectar.", description: "Canais separados encontram um mesmo centro." },
  executing: { label: "Executando", status: "Comando em execução", title: "Transformando intenção em ação.", description: "Acompanhe cada passo. Só acontece o que você aprovou." },
  success: { label: "Concluído", status: "Execução concluída", title: "Feito. Mais espaço no seu dia.", description: "Um pulso de confirmação. Pronta para o próximo comando." },
  attention: { label: "Sua decisão", status: "Aguardando autorização", title: "O próximo passo é seu.", description: "Antes de agir, quero ter certeza de que você está de acordo." },
  error: { label: "Imprevisto", status: "Interrupção detectada · recuperação disponível", title: "Uma pausa. Não um ponto final.", description: "Algo não saiu como esperado. Vamos por outro caminho?" },
} as const satisfies Record<string, FalaDoEstado>;

export type EstadoNucleo = keyof typeof ESTADOS_NUCLEO;
