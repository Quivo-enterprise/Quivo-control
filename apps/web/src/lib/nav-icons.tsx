import {
  AlertTriangle,
  Building2,
  Bell,
  Bus,
  FileBarChart,
  GitBranch,
  House,
  LayoutDashboard,
  MapPin,
  ListOrdered,
  Radio,
  RotateCw,
  Scale,
  ShieldAlert,
  Sparkles,
  UserCheck,
  UserCog,
  Users,
} from 'lucide-react';

export function getNavIcon(iconName?: string, size = 18, strokeWidth = 1.9) {
  switch (iconName) {
    case 'House':
      return <House size={size} strokeWidth={strokeWidth} />;
    case 'Bell':
      return <Bell size={size} strokeWidth={strokeWidth} />;
    case 'LayoutDashboard':
      return <LayoutDashboard size={size} strokeWidth={strokeWidth} />;
    case 'ListOrdered':
      return <ListOrdered size={size} strokeWidth={strokeWidth} />;
    case 'Radio':
      return <Radio size={size} strokeWidth={strokeWidth} />;
    case 'Building2':
      return <Building2 size={size} strokeWidth={strokeWidth} />;
    case 'Users':
      return <Users size={size} strokeWidth={strokeWidth} />;
    case 'Bus':
      return <Bus size={size} strokeWidth={strokeWidth} />;
    case 'UserCheck':
      return <UserCheck size={size} strokeWidth={strokeWidth} />;
    case 'GitBranch':
      return <GitBranch size={size} strokeWidth={strokeWidth} />;
    case 'MapPin':
      return <MapPin size={size} strokeWidth={strokeWidth} />;
    case 'RotateCw':
      return <RotateCw size={size} strokeWidth={strokeWidth} />;
    case 'Scale':
      return <Scale size={size} strokeWidth={strokeWidth} />;
    case 'FileBarChart':
      return <FileBarChart size={size} strokeWidth={strokeWidth} />;
    case 'ShieldAlert':
      return <ShieldAlert size={size} strokeWidth={strokeWidth} />;
    case 'AlertTriangle':
      return <AlertTriangle size={size} strokeWidth={strokeWidth} />;
    case 'UserCog':
      return <UserCog size={size} strokeWidth={strokeWidth} />;
    default:
      return <Sparkles size={size} strokeWidth={strokeWidth} />;
  }
}
