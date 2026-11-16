"""Cria (ou redefine a senha de) um usuário do orquestrador pela linha de comando.
Use para criar o primeiro administrador; os demais podem ser criados pela tela Usuários.

    env\\Scripts\\python api\\criar_usuario.py admin "Administrador"
    env\\Scripts\\python api\\criar_usuario.py maria "Maria Souza" --perfil visualizador

A senha é pedida no terminal (não aparece na tela). Se o login já existir, a senha,
o nome e o perfil são atualizados e o usuário é reativado.
"""
from __future__ import annotations

import argparse
import getpass
import sys

import db
from auth import PERFIS, hash_senha, validar_senha_nova


def main() -> int:
    p = argparse.ArgumentParser(description="Cria ou atualiza um usuário do orquestrador")
    p.add_argument("login")
    p.add_argument("nome")
    p.add_argument("--perfil", choices=PERFIS, default="admin")
    a = p.parse_args()

    senha = getpass.getpass("Senha: ")
    if (erro := validar_senha_nova(senha)):
        print(erro)
        return 1
    if getpass.getpass("Repita a senha: ") != senha:
        print("As senhas não conferem")
        return 1

    login = a.login.strip().lower()
    existe = db.um("SELECT id FROM PY_Usuario WHERE login = ?", login)
    if existe:
        db.query("UPDATE PY_Usuario SET nome = ?, perfil = ?, senha_hash = ?, ativo = 1 WHERE id = ?",
                 a.nome, a.perfil, hash_senha(senha), existe["id"])
        print(f"Usuário '{login}' atualizado ({a.perfil}).")
    else:
        db.query("INSERT INTO PY_Usuario (login, nome, perfil, senha_hash) VALUES (?, ?, ?, ?)",
                 login, a.nome, a.perfil, hash_senha(senha))
        print(f"Usuário '{login}' criado ({a.perfil}).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
