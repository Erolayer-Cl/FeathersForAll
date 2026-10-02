import { Book, FileText, House, Plus, Settings, SquareCheck } from 'lucide-react';
import { Drawer } from '../../components/Drawer/Drawer.jsx';
import { DrawerAction } from '../../components/Drawer/DrawerAction.jsx';
import { DrawerItem } from '../../components/Drawer/DrawerItem.jsx';
import { DrawerNav } from '../../components/Drawer/DrawerNav.jsx';
import { HistoryList } from '../../components/Drawer/HistoryList.jsx';
import { AULA_NAV } from '../../config/modes.js';

const AULA_ICONS = { inicio: House, cursos: Book, notas: FileText };

/** Contenido del menú hamburguesa según el modo (Tutor o Aula virtual). */
export function ChatMenu({ state, chatKey, history, title, returnFocusRef, actions }) {
  const isTutor = state.mode === 'tutor';

  return (
    <Drawer
      id="app-drawer"
      open={state.menuOpen}
      title={title}
      onClose={actions.closeMenu}
      returnFocusRef={returnFocusRef}
    >
      {isTutor ? (
        <>
          <DrawerAction icon={Plus} label="Nueva conversación" onClick={actions.newChat} />
          <DrawerItem
            icon={SquareCheck}
            label="Pruebas"
            active={chatKey === 'pruebas'}
            onClick={actions.openPruebas}
          />
          <HistoryList entries={history} onOpen={actions.openEntry} />
        </>
      ) : (
        <DrawerNav label="Aula virtual">
          {AULA_NAV.map(({ id, label }) => (
            <DrawerItem
              key={id}
              icon={AULA_ICONS[id]}
              label={label}
              tone="accent2"
              active={state.aulaNav === id}
              onClick={() => actions.setAulaNav(id)}
            />
          ))}
        </DrawerNav>
      )}
      {/* Pantalla de configuración aún no diseñada: por ahora solo cierra el menú. */}
      <DrawerItem icon={Settings} label="Configuración" onClick={actions.closeMenu} />
    </Drawer>
  );
}
