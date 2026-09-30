# DEMO RAG : RECHERCHE SYNTAXIQUE + SEMANTIQUE

## OBJECTIFS

Les objectifs de ce mini-projet est de démontrer un workflow de recherche hybride RAG complet avec les différentes étapes : 

1. création d'une corpus de documents texte constituant une base de donnée métier de slogans publicitaires  
2. indexation des documents de cette base de données dans une base de donnée vectorielle
3. démo d'une mini application d'interrogation interactive de cette base indexée via un LLM. Exemples de requètes en language naturel:
  - Donnes moi tous les slogans sur des produits laitiers de l'année 2005
  - Donnes moi tous les slogans similaires dans leur forme à "Un peu de sucre, beaucoups d'idées"
  - Liste moi tous les slogans sur le sucre de ta base

Pour résumer : nous voulons pouvoir rechercher des slogans similaires à un modèle ou contenant quelques mots clés selon leur forme (ressemblance) et/ou leur sens (signification voisine dans des formes différentes)
Bien sûr la recherche interractive doit être insensible aux typos de l'utilisateur, les mots homonymes doivent être différencié par leur contexte d'utilisation..

Cette démonstration doit aussi permettre de comparer les performances de plusieurs bases de données vectorielles ainsi que les la rapidité de réponse de plusieurs modèles LLMs que nous sélectionneront par rapport à leur coût par requète ou à la possibilité de les héberger localement. 

## INSPIRATION, AUTRES DEMOS

S'inspirer autant que possibles des résultats d'études similaires publiées sur internet, de vidéos explicatives sur Youtube et de repo github contenant des éléments réutilisables.

Liste de projets à analyser (à compléter au fur et à mesure avec toutes les bases de données cibles de notre panel)

* https://github.com/andrisgauracs/Star-Wars-Movie-Expert (projet associé à une vidéo Youtube [
How to Build a RAG System That Actually Works](https://youtu.be/pvCabUerwss) : Python + langchain + Qdrant)
* https://github.com/dataO1/q (Qdrant + Redis + Ollama)

## STACK TECHNIQUE

Les scripts applicatifs et l'interface web seront réalisés en langage Typescript avec [bun](https://bun.com/reference) qui contient nativement des clients redis ou postgresql.

Pour les bases de données vectorielles ou graphe, _uniquement les solutions open source déployables sur nos propres serveurs_ retiennent notre attention.
Voici une liste de candidats déjà identifiés (à confirmer en fonction de leurs capacités respectives)

* [Redis](https://redis.io/docs/latest/develop/get-started/rag/)
* [ElasticSearch]
* [Qadrant](https://qdrant.tech/)
* [PostgreSQL + PG Vector extension](https://github.com/pgvector/pgvector)
