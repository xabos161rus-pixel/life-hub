import { describe, expect, it } from 'vitest';
import type { Note, NoteFolder } from '../../db/types';
import {
  childrenByParent,
  countNotesDeep,
  flattenTree,
  folderMoveTargets,
  withDescendants,
} from './folderTree';

const F = (id: string, parentId: string | null, sortOrder = 0): NoteFolder => ({
  id,
  name: id,
  emoji: '📁',
  color: '#000',
  sortOrder,
  parentId,
  createdAt: '',
  updatedAt: '',
  deletedAt: null,
});

const N = (id: string, folderId: string | null): Note => ({
  id,
  title: id,
  content: '',
  tags: [],
  pinned: false,
  folderId,
  createdAt: '',
  updatedAt: '',
  deletedAt: null,
});

// Работа › Проекты › RTE; Дом — отдельно в корне.
const TREE = [F('work', null, 1), F('home', null, 2), F('proj', 'work'), F('rte', 'proj')];

describe('дерево папок', () => {
  it('дети раскладываются по уровням и сортируются', () => {
    const by = childrenByParent(TREE);
    expect(by.get('')!.map((f) => f.id)).toEqual(['work', 'home']);
    expect(by.get('work')!.map((f) => f.id)).toEqual(['proj']);
    expect(by.get('rte')).toBeUndefined();
  });

  it('потомки собираются на всю глубину', () => {
    expect([...withDescendants(TREE, 'work')].sort()).toEqual(['proj', 'rte', 'work']);
    expect([...withDescendants(TREE, 'home')]).toEqual(['home']);
  });

  it('счётчик считает заметки вместе с вложенными папками', () => {
    const notes = [N('a', 'work'), N('b', 'rte'), N('c', 'home'), N('d', null)];
    expect(countNotesDeep(notes, TREE, 'work')).toBe(2); // своя + в глубине
    expect(countNotesDeep(notes, TREE, 'proj')).toBe(1);
    expect(countNotesDeep(notes, TREE, 'home')).toBe(1);
  });

  it('flatten даёт порядок обхода в глубину с глубиной уровня', () => {
    expect(flattenTree(TREE).map((x) => `${x.folder.id}:${x.depth}`)).toEqual([
      'work:0',
      'proj:1',
      'rte:2',
      'home:0',
    ]);
  });

  it('осиротевшая ветка не исчезает — поднимается в корень', () => {
    // Родитель 'lost' не существует (удалён на другом устройстве).
    const rows = [F('a', null), F('orphan', 'lost'), F('child', 'orphan')];
    const flat = flattenTree(rows).map((x) => `${x.folder.id}:${x.depth}`);
    expect(flat).toEqual(['a:0', 'orphan:0', 'child:1']);
  });

  it('цикл в битых данных не подвешивает обход', () => {
    const rows = [F('x', 'y'), F('y', 'x')];
    expect(flattenTree(rows)).toHaveLength(2);
    expect(withDescendants(rows, 'x').size).toBe(2);
  });

  it('цели переноса папки — без неё самой и её потомков', () => {
    // 'work' нельзя ни в себя, ни в 'proj'/'rte' (свои потомки) — только 'home'.
    expect(folderMoveTargets(TREE, 'work').map((x) => x.folder.id)).toEqual(['home']);
    // Листовой 'rte' можно куда угодно, кроме себя; порядок — как в дереве.
    expect(folderMoveTargets(TREE, 'rte').map((x) => x.folder.id)).toEqual([
      'work',
      'proj',
      'home',
    ]);
  });
});
