// Íconos del portal en un solo lugar (lucide-react, ya instalado). Los menús usan el nombre, no el componente.
import {
  BarChart3,
  BookOpen,
  Check,
  ChevronDown,
  ClipboardCheck,
  FileText,
  GraduationCap,
  House,
  Menu,
  MessageCircle,
  Monitor,
  Moon,
  Palette,
  SlidersHorizontal,
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
  chevron: ChevronDown,
  sun: Sun,
  moon: Moon,
  monitor: Monitor,
  palette: Palette,
};

/** @param {{name: keyof typeof ICONS, size?: number}} props */
export function Icon({ name, size = 20, className }) {
  const Cmp = ICONS[name];
  return Cmp ? <Cmp size={size} strokeWidth={2.4} className={className} aria-hidden="true" /> : null;
}
