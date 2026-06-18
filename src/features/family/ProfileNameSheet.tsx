import { useState } from 'react';
import { Sheet } from '../../components/ui/Sheet';
import { Field, Input } from '../../components/ui/Input';
import { Button } from '../../components/ui/Button';
import { upsertSelfMember } from '../../lib/family/familyRepo';

interface Props {
  open: boolean;
  currentName: string;
  onClose: () => void;
}

/** Изменить своё имя в семье. */
export function ProfileNameSheet({ open, currentName, onClose }: Props) {
  const [name, setName] = useState(currentName);

  async function save() {
    if (!name.trim()) return;
    await upsertSelfMember(name);
    onClose();
  }

  return (
    <Sheet open={open} onClose={onClose} title="Ваше имя">
      <div className="space-y-4">
        <Field label="Имя в семье">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Например, Влад" autoFocus />
        </Field>
        <Button className="w-full" disabled={!name.trim()} onClick={() => void save()}>
          Сохранить
        </Button>
      </div>
    </Sheet>
  );
}
