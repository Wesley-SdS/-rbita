// Bibliotecas sem tipos publicados. Só o que o extrator usa, conferido no código delas.

declare module "word-extractor" {
  interface DocumentoDoWord {
    getBody(): string;
    getFootnotes(): string;
    getEndnotes(): string;
    getHeaders(opcoes?: { includeFooters?: boolean }): string;
    getFooters(): string;
    getAnnotations(): string;
    getTextboxes(opcoes?: { includeHeadersAndFooters?: boolean; includeBody?: boolean }): string;
  }
  class WordExtractor {
    extract(fonte: string | Buffer): Promise<DocumentoDoWord>;
  }
  export = WordExtractor;
}
