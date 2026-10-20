// Optional parts of Viewzo, switched on by a super admin in the back-office.
export const PLATFORM_MODULES = {
  LIVE_SALES: {
    name: 'Vente en live TikTok',
    description:
      'Les vendeurs lisent les commentaires de leurs lives TikTok, l’IA repère les acheteurs et crée les paniers.',
  },
} as const;

export type ModuleKey = keyof typeof PLATFORM_MODULES;

export const isModuleKey = (key: string): key is ModuleKey =>
  Object.prototype.hasOwnProperty.call(PLATFORM_MODULES, key);
