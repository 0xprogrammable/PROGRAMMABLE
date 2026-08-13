import { Menu, X } from "lucide-react";

type NavigationIconProps = {
  className?: string;
};

export function NavigationMenuIcon({ className }: NavigationIconProps) {
  return <Menu aria-hidden="true" className={className} strokeWidth={1.8} />;
}

export function NavigationCloseIcon({ className }: NavigationIconProps) {
  return <X aria-hidden="true" className={className} strokeWidth={1.8} />;
}
