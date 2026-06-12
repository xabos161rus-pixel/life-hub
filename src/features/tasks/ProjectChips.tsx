import { useLiveQuery } from 'dexie-react-hooks';
import { Pencil } from 'lucide-react';
import { db } from '../../db/db';
import { alive } from '../../db/repo';
import type { Project } from '../../db/types';
import { Chip, ChipRow } from '../../components/ui/Chip';

/** Полоса фильтра по проектам: «Все», чипы проектов (карандаш у активного), «+ Проект». */
export function ProjectChips({
  value,
  onChange,
  onEditProject,
}: {
  value: string | null;
  onChange: (id: string | null) => void;
  onEditProject: (p: Project | null) => void;
}) {
  const projects =
    useLiveQuery(
      async () =>
        alive(await db.projects.toArray())
          .filter((p) => !p.archivedAt)
          .sort((a, b) => a.sortOrder - b.sortOrder),
      [],
    ) ?? [];

  return (
    <ChipRow>
      <Chip active={value === null} onClick={() => onChange(null)}>
        Все
      </Chip>
      {projects.map((p) => (
        <Chip key={p.id} active={value === p.id} onClick={() => onChange(p.id)}>
          {p.emoji} {p.name}
          {value === p.id && (
            <Pencil
              size={13}
              className="ml-1.5 inline-block align-[-1px]"
              aria-label="Редактировать проект"
              onClick={(e) => {
                e.stopPropagation();
                onEditProject(p);
              }}
            />
          )}
        </Chip>
      ))}
      <Chip onClick={() => onEditProject(null)}>+ Проект</Chip>
    </ChipRow>
  );
}
