# Analisador de comandos PowerShell da Orbita (PRD A3).
#
# Fica ABERTO: recebe um pedido JSON por linha no stdin e devolve os FATOS do
# comando, uma linha JSON por pedido, no stdout. Subir um powershell por analise
# custaria centenas de milissegundos. Usa o parser OFICIAL
# ([System.Management.Automation.Language.Parser]::ParseInput), entao alias,
# crase de continuacao, ";" depois de espacos e $() aparecem como o PowerShell
# os entende, nao como uma regex acha que entende. NADA aqui executa o comando.
#
# Arquivo em ASCII de proposito: o Windows PowerShell 5.1 le script sem BOM na
# pagina de codigo do sistema.

$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)

$aliases = @{}
foreach ($a in (Get-Alias)) { $aliases[$a.Name.ToLowerInvariant()] = [string]$a.Definition }

$operadoresDoToken = @{ 'Semi' = ';'; 'Pipe' = '|'; 'AndAnd' = '&&'; 'OrOr' = '||'; 'Ampersand' = '&'; 'NewLine' = 'nova_linha' }

function Get-TextoDoArgumento($el) {
    $t = $el.GetType().Name
    if ($t -eq 'StringConstantExpressionAst') { return @{ texto = [string]$el.Value; dinamico = $false } }
    if ($t -eq 'ConstantExpressionAst') { return @{ texto = [string]$el.Value; dinamico = $false } }
    if ($t -eq 'CommandParameterAst') {
        $p = '-' + $el.ParameterName
        if ($null -ne $el.Argument) {
            $inner = Get-TextoDoArgumento $el.Argument
            return @{ texto = ($p + ':' + $inner.texto); dinamico = $inner.dinamico }
        }
        return @{ texto = $p; dinamico = $false }
    }
    if ($t -eq 'ExpandableStringExpressionAst') {
        return @{ texto = [string]$el.Value; dinamico = ($el.NestedExpressions.Count -gt 0) }
    }
    if ($t -eq 'ArrayLiteralAst') {
        $partes = @(); $din = $false
        foreach ($x in $el.Elements) { $r = Get-TextoDoArgumento $x; $partes += $r.texto; if ($r.dinamico) { $din = $true } }
        return @{ texto = ($partes -join ','); dinamico = $din }
    }
    return @{ texto = [string]$el.Extent.Text; dinamico = $true }
}

while ($true) {
    $linha = [Console]::In.ReadLine()
    if ($null -eq $linha) { break }
    $id = $null
    try {
        $pedido = $linha | ConvertFrom-Json
        $id = $pedido.id
        $tokens = $null
        $erros = $null
        $ast = [System.Management.Automation.Language.Parser]::ParseInput([string]$pedido.comando, [ref]$tokens, [ref]$erros)
        $comandos = New-Object System.Collections.ArrayList
        $redir = New-Object System.Collections.ArrayList
        $subs = New-Object System.Collections.ArrayList
        $metodos = New-Object System.Collections.ArrayList
        $tipos = New-Object System.Collections.ArrayList
        $atrib = 0
        foreach ($n in $ast.FindAll({ $true }, $true)) {
            switch ($n.GetType().Name) {
                'CommandAst' {
                    $nome = $n.GetCommandName()
                    $argumentos = New-Object System.Collections.ArrayList
                    $argsDin = $false
                    $els = $n.CommandElements
                    for ($i = 1; $i -lt $els.Count; $i++) {
                        $r = Get-TextoDoArgumento $els[$i]
                        [void]$argumentos.Add([string]$r.texto)
                        if ($r.dinamico) { $argsDin = $true }
                    }
                    $resolvido = $nome
                    if ($nome -and $aliases.ContainsKey($nome.ToLowerInvariant())) { $resolvido = $aliases[$nome.ToLowerInvariant()] }
                    $inv = $null
                    if ($n.InvocationOperator -eq 'Ampersand') { $inv = '&' } elseif ($n.InvocationOperator -eq 'Dot') { $inv = '.' }
                    [void]$comandos.Add(@{
                        nome = $(if ($nome) { [string]$nome } else { [string]$els[0].Extent.Text })
                        nome_resolvido = $(if ($resolvido) { [string]$resolvido } else { $null })
                        dinamico = ($null -eq $nome)
                        args = @($argumentos)
                        args_dinamicos = $argsDin
                        invocacao = $inv
                    })
                }
                'FileRedirectionAst' { [void]$redir.Add(@{ tipo = 'arquivo'; alvo = [string]$n.Location.Extent.Text; anexar = [bool]$n.Append }) }
                'MergingRedirectionAst' { [void]$redir.Add(@{ tipo = 'mescla'; alvo = $null; anexar = $false }) }
                'SubExpressionAst' { [void]$subs.Add(@{ tipo = 'subexpressao'; texto = [string]$n.Extent.Text }) }
                'ScriptBlockExpressionAst' { [void]$subs.Add(@{ tipo = 'bloco'; texto = [string]$n.Extent.Text }) }
                'ExpandableStringExpressionAst' { if ($n.NestedExpressions.Count -gt 0) { [void]$subs.Add(@{ tipo = 'texto_expandido'; texto = [string]$n.Extent.Text }) } }
                'InvokeMemberExpressionAst' { [void]$metodos.Add(@{ membro = [string]$n.Member.Extent.Text; alvo = [string]$n.Expression.Extent.Text; estatico = [bool]$n.Static }) }
                'TypeExpressionAst' { [void]$tipos.Add([string]$n.TypeName.FullName) }
                'ConvertExpressionAst' { [void]$tipos.Add([string]$n.Type.TypeName.FullName) }
                'AssignmentStatementAst' { $atrib++ }
            }
        }
        $ops = New-Object System.Collections.ArrayList
        foreach ($tk in $tokens) {
            $k = [string]$tk.Kind
            if ($operadoresDoToken.ContainsKey($k)) { $o = $operadoresDoToken[$k]; if (-not $ops.Contains($o)) { [void]$ops.Add($o) } }
        }
        $instr = 0
        if ($ast.EndBlock) { $instr = $ast.EndBlock.Statements.Count }
        $resp = @{
            id = $id
            shell = 'powershell'
            parse_ok = ($erros.Count -eq 0)
            erros = @($erros | ForEach-Object { [string]$_.Message })
            comandos = @($comandos)
            redirecionamentos = @($redir)
            substituicoes = @($subs)
            metodos = @($metodos)
            tipos = @($tipos)
            operadores = @($ops)
            atribuicoes = $atrib
            instrucoes = $instr
        }
        [Console]::Out.WriteLine(($resp | ConvertTo-Json -Compress -Depth 8))
    } catch {
        $falha = @{ id = $id; shell = 'powershell'; parse_ok = $false; erros = @([string]$_.Exception.Message); comandos = @(); redirecionamentos = @(); substituicoes = @(); metodos = @(); tipos = @(); operadores = @(); atribuicoes = 0; instrucoes = 0 }
        [Console]::Out.WriteLine(($falha | ConvertTo-Json -Compress -Depth 8))
    }
    [Console]::Out.Flush()
}
