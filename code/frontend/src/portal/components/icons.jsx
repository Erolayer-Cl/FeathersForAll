// Íconos del portal en un solo lugar (lucide-react, ya instalado). Los menús usan el nombre, no el componente.
import {
  ArrowUp,
  BarChart3,
  BookOpen,
  Check,
  ClipboardCheck,
  Copy,
  FileText,
  GraduationCap,
  House,
  Menu,
  MessageCircle,
  Monitor,
  Moon,
  Palette,
  Plus,
  RotateCcw,
  SlidersHorizontal,
  Square,
  Sun,
  TrendingUp,
  Users,
  X,
} from 'lucide-react';

const ICONS = {
  home: House,
  book: BookOpen,
  notes: FileText,
  chat: MessageCircle,
  trend: TrendingUp,
  users: Users,
  check: ClipboardCheck,
  bars: BarChart3,
  school: GraduationCap,
  sliders: SlidersHorizontal,
  menu: Menu,
  close: X,
  tick: Check,
  sun: Sun,
  moon: Moon,
  monitor: Monitor,
  palette: Palette,
  send: ArrowUp,
  stop: Square,
  copy: Copy,
  retry: RotateCcw,
  plus: Plus,
};

/** @param {{name: keyof typeof ICONS, size?: number}} props */
export function Icon({ name, size = 20 }) {
  const Cmp = ICONS[name];
  return Cmp ? <Cmp size={size} strokeWidth={2.4} aria-hidden="true" /> : null;
}
