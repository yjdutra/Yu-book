import { useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { CabecalhoAjustes } from "../components/ajustes/CabecalhoAjustes";
import { SecaoGasto } from "../components/ajustes/SecaoGasto";
import { SecaoModelos } from "../components/ajustes/SecaoModelos";
import { SecaoOpenRouter } from "../components/ajustes/SecaoOpenRouter";
import { SecaoProvedor } from "../components/ajustes/SecaoProvedor";

/**
 * Ajustes de IA — a única tela de configuração do Yu-book.
 *
 * Dividida em seções no redesenho de UI (Etapa 4), com a navegação entre elas
 * no painel contextual (`SECOES_DE_AJUSTES`). O cabeçalho é o mesmo em todas:
 * o aviso de que o conteúdo sai da máquina e o gasto de hoje não podem ficar
 * atrás de uma aba.
 *
 * Os cartões vinham copiados do dashboard, com a decisão de manter `Button` e
 * `Modal` inexistentes no projeto. O redesenho revogou isso: as seções usam os
 * primitivos de `components/base/`.
 */
export function AjustesPage() {
  const [erro, setErro] = useState<string | null>(null);

  return (
    <main className="flex min-w-0 flex-1 flex-col overflow-y-auto">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-8 py-6">
        <CabecalhoAjustes erro={erro} onFecharErro={() => setErro(null)} />
        <Routes>
          <Route index element={<Navigate to="modelos" replace />} />
          <Route path="modelos" element={<SecaoModelos onErro={setErro} />} />
          <Route path="provedor" element={<SecaoProvedor onErro={setErro} />} />
          <Route path="gasto" element={<SecaoGasto onErro={setErro} />} />
          {/* Sem `onErro`: a seção só consulta, e cada bloco mostra o próprio erro. */}
          <Route path="openrouter" element={<SecaoOpenRouter />} />
          <Route path="*" element={<Navigate to="modelos" replace />} />
        </Routes>
      </div>
    </main>
  );
}
