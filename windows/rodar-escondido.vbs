' Liga o Ofertas RoB7 sem abrir janela preta.
Set fso = CreateObject("Scripting.FileSystemObject")
pasta = fso.GetParentFolderName(WScript.ScriptFullName)
Set sh = CreateObject("WScript.Shell")
sh.Run "cmd /c """ & pasta & "\loop.cmd""", 0, False
