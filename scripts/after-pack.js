'use strict';
// Después de empaquetar: le pone al .exe el ícono propio y los datos de versión.
// (Se hace acá con "resedit", en JavaScript puro, para poder generar el .exe de Windows desde Linux/Mac sin Wine.)
const fs = require('fs');
const path = require('path');

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') return;
  const { appOutDir, packager } = context;
  const exePath = path.join(appOutDir, `${packager.appInfo.productFilename}.exe`);
  const icoPath = path.join(packager.projectDir, 'build', 'icon.ico');
  try {
    const ResEdit = await import('resedit');
    const exe = ResEdit.NtExecutable.from(fs.readFileSync(exePath));
    const res = ResEdit.NtExecutableResource.from(exe);

    const iconFile = ResEdit.Data.IconFile.from(fs.readFileSync(icoPath));
    const groups = ResEdit.Resource.IconGroupEntry.fromEntries(res.entries);
    const g = groups[0];
    ResEdit.Resource.IconGroupEntry.replaceIconsForResource(res.entries, g ? g.id : 1, g ? g.lang : 1033, iconFile.icons.map((i) => i.data));

    const vi = ResEdit.Resource.VersionInfo.fromEntries(res.entries)[0];
    if (vi) {
      const [maj, min, pat] = String(packager.appInfo.version).split('.').map((n) => parseInt(n, 10) || 0);
      vi.setFileVersion(maj, min, pat, 0, 1033);
      vi.setProductVersion(maj, min, pat, 0, 1033);
      vi.setStringValues(
        { lang: 1033, codepage: 1200 },
        {
          FileDescription: 'Calculadora de Alquileres',
          ProductName: 'Calculadora de Alquileres',
          CompanyName: 'Inmobiliaria M.M. Fuentes',
          LegalCopyright: 'Inmobiliaria M.M. Fuentes',
          OriginalFilename: `${packager.appInfo.productFilename}.exe`,
          InternalName: 'Calculadora de Alquileres',
        }
      );
      vi.outputToResourceEntries(res.entries);
    }

    res.outputResource(exe);
    fs.writeFileSync(exePath, Buffer.from(exe.generate()));
    console.log('  • ícono y datos de versión aplicados a', path.basename(exePath));
  } catch (e) {
    console.warn('  • AVISO: no se pudo aplicar el ícono al .exe:', e && e.message ? e.message : e);
  }
};
