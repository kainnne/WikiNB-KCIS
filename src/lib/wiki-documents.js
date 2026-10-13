export function schoolDocumentsIndex(files,categories=[],base='/'){
  const categoryNames=new Map(categories.map(category=>[category.id,category.en]));
  return (files||[]).filter(file=>/^[a-f0-9-]{36}$/.test(file.id)&&!file.deletedAt).map(file=>({
    slug:'documents/'+file.id,title:file.title||file.filename,displayFilename:file.filename,
    role:file.role,category:file.category,categoryZh:categories.find(category=>category.id===file.category)?.zh,
    teacher:file.uploader,subject:categoryNames.get(file.category)||file.category,subjectEn:categoryNames.get(file.category)||file.category,
    keywords:file.keywords||[],keywordsEn:file.keywords||[],tags:[],description:'',bodyText:'',html:'',
    href:base+'note?'+new URLSearchParams({file:file.id}),live:true,
  }));
}
