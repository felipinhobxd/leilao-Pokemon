import {parseArgs} from 'node:util';
import {resolve} from 'node:path';
import {createRecoveryPackage,verifyRecoveryPackage} from '../lib/recovery-package.mjs';

const {values}=parseArgs({options:{file:{type:'string'},output:{type:'string'},images:{type:'boolean'},'source-origin':{type:'string'},verify:{type:'boolean'},help:{type:'boolean'}}});
if(values.help||!values.output||(!values.verify&&!values.file)) {
  console.log('Criar: npm run backup:pack -- --file backup.json.gz --output D:\\Backups\\pacote-novo [--images --source-origin https://PROJETO.supabase.co]');
  console.log('Conferir: npm run backup:pack -- --verify --output D:\\Backups\\pacote-novo');
  console.log('Não executa SQL nem inicia o bot. Imagens só são baixadas com --images. A pasta de destino deve ser nova.');
  if(!values.help)process.exitCode=1;
} else {
  try {
    const result=values.verify?await verifyRecoveryPackage(resolve(values.output)):
      await createRecoveryPackage({file:resolve(values.file),output:resolve(values.output),downloadImages:values.images,sourceOrigin:values['source-origin']});
    console.log(JSON.stringify({verified:!!values.verify,rows:result.rows,images:result.images.length,images_complete:result.images_complete},null,2));
    if(!result.images_complete){console.error('Pacote com imagens incompletas. Confira os itens no manifest.json; não considere uma recuperação integral.');process.exitCode=2;}
  }catch(error){console.error(`Pacote não concluído: ${error.message}`);process.exitCode=1;}
}
