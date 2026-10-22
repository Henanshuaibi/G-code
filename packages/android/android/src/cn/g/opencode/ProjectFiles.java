package cn.g.opencode;
import java.io.File;
final class ProjectFiles {
    static void remove(File file){if(file.isDirectory()&&!java.nio.file.Files.isSymbolicLink(file.toPath())){File[] files=file.listFiles();if(files!=null)for(File child:files)remove(child);}file.delete();}
}
