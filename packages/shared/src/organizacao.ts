import { z } from "zod";

const COR = /^#[0-9a-fA-F]{6}$/;

export const workspaceInputSchema = z.object({
  name: z.string().trim().min(1, "Informe um nome").max(60),
  color: z.string().regex(COR, "Cor inválida").default("#6366f1"),
});

export const workspaceUpdateSchema = workspaceInputSchema.partial().refine(
  (v) => Object.keys(v).length > 0,
  "Nada para atualizar",
);

export type WorkspaceInput = z.input<typeof workspaceInputSchema>;

export interface Workspace {
  id: string;
  name: string;
  color: string;
  noteCount: number;
}

export const tagUpdateSchema = z.object({
  name: z.string().trim().min(1).max(40).optional(),
  color: z.string().regex(COR, "Cor inválida").optional(),
});

export interface Tag {
  id: string;
  name: string;
  color: string;
  noteCount: number;
}
