import { notarize } from 'electron-builder-notarize';

export default async function notarizeApp(context) {
  const { electronPlatformName, appOutDir } = context;
  if (electronPlatformName !== 'darwin') {
    return;
  }

  const appName = context.packager.appInfo.productFilename;

  await notarize({
    appBundleId: 'com.supercmd.app',
    appPath: `${appOutDir}/${appName}.app`,
    appleId: '',
    appleIdPassword: '',
  });
}