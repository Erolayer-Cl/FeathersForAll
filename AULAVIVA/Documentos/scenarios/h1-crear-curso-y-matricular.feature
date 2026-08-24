# language: es
Característica: Crear curso y matricular estudiantes
  Como Docente
  quiero crear un curso y matricular a mis estudiantes en él
  para gestionar mi grupo de forma aislada dentro de mi colegio (tenant)

  Escenario: Un docente crea un curso dentro de su propio colegio
    Dado que soy un docente autenticado en el tenant "Colegio San Rafael"
    Cuando creo un curso llamado "Matemática 8vo Básico" para el periodo "2026-1"
    Entonces el curso queda asociado únicamente al tenant "Colegio San Rafael"

  Escenario: Un docente matricula a un estudiante en su curso
    Dado que existe el curso "Matemática 8vo Básico" en mi tenant
    Cuando matriculo al estudiante con correo "estudiante@sanrafael.cl"
    Entonces el estudiante aparece en la lista de matriculados del curso

  Escenario: No se puede matricular a un estudiante de otro colegio
    Dado que el estudiante "estudiante@otrocolegio.cl" pertenece al tenant "Colegio Los Andes"
    Cuando un docente del tenant "Colegio San Rafael" intenta matricularlo en su curso
    Entonces el sistema rechaza la operación por aislamiento entre tenants
